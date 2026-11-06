import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { framerConfigured } from '@/lib/framer-cms'
import { importFramerCms } from '@/lib/cms-import'
import { encryptSecret } from '@/lib/crypto'
import { maintenanceStatus } from '@/lib/maintenance'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Website-instellingen van één klant: hoe de site gebouwd is (framer | custom),
// het CMS (enkel bij framer), de beheerlink (enkel bij custom) en het onderhoud.
// De API-sleutel wordt NOOIT teruggegeven aan de browser.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()

    // select('*') zodat een nog niet-gemigreerde kolom nooit de hele kaart breekt.
    const { data: client } = await admin.from('clients').select('*').eq('id', id).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })

    let collections: unknown[] = []
    try {
      const { data } = await admin
        .from('cms_collections')
        .select('id, framer_collection_id, name, slug, fields, client_editable, item_count, synced_at')
        .eq('client_id', id)
        .order('name', { ascending: true })
      collections = data ?? []
    } catch { /* tabel mogelijk nog niet gemigreerd */ }

    return NextResponse.json({
      platform: client.website_platform ?? '',
      adminUrl: client.website_admin_url ?? '',
      projectUrl: client.framer_project_url ?? '',
      hasApiKey: !!client.framer_api_key,        // enkel of er een sleutel is, nooit de sleutel zelf
      cmsEnabled: !!client.cms_enabled,
      configured: framerConfigured(client),
      maintenance: {
        included: !!client.maintenance_included,
        startDate: client.maintenance_start_date ?? '',
        months: client.maintenance_months ?? 12,
        status: maintenanceStatus(client),
      },
      collections,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — instellingen opslaan. Lege apiKey = bestaande sleutel behouden.
// Bij een complete Framer-koppeling wordt de CMS meteen opgehaald, zodat de
// klant direct alle velden en items ziet zonder extra handeling.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const body = await req.json()
    const admin = createAdminSupabaseClient()

    const { data: client } = await admin.from('clients').select('id, company_name').eq('id', id).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })

    const patch: Record<string, unknown> = {}
    if (body.platform !== undefined) {
      const p = String(body.platform).trim()
      patch.website_platform = p === 'framer' || p === 'custom' ? p : null
    }
    if (body.adminUrl !== undefined) patch.website_admin_url = String(body.adminUrl).trim() || null
    if (body.projectUrl !== undefined) patch.framer_project_url = String(body.projectUrl).trim() || null
    // Versleuteld opslaan (AES-256-GCM): een databaselek geeft dan geen directe
    // schrijftoegang tot de website van de klant. Vereist BLOG_ENC_KEY in de env.
    if (typeof body.apiKey === 'string' && body.apiKey.trim()) patch.framer_api_key = encryptSecret(body.apiKey.trim())
    if (typeof body.cmsEnabled === 'boolean') patch.cms_enabled = body.cmsEnabled

    if (body.maintenance && typeof body.maintenance === 'object') {
      const m = body.maintenance
      if (typeof m.included === 'boolean') patch.maintenance_included = m.included
      if (m.startDate !== undefined) patch.maintenance_start_date = String(m.startDate).trim() || null
      if (m.months !== undefined) {
        const n = Number(m.months)
        patch.maintenance_months = Number.isFinite(n) && n > 0 ? Math.round(n) : 12
      }
      // Instellingen gewijzigd → herinnering mag opnieuw uitgaan voor de nieuwe einddatum.
      patch.maintenance_reminder_sent_for = null
    }

    if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true })

    const { error } = await admin.from('clients').update(patch).eq('id', id)
    if (error) throw new Error(error.message)

    // CMS meteen ophalen wanneer de koppeling compleet is en het CMS aan staat.
    let imported: { collections: number; items: number } | null = null
    let importError: string | null = null
    const { data: fresh } = await admin
      .from('clients').select('framer_project_url, framer_api_key, cms_enabled, website_platform').eq('id', id).maybeSingle()
    if (fresh?.website_platform === 'framer' && fresh.cms_enabled && framerConfigured(fresh)) {
      try {
        const s = await importFramerCms(id)
        imported = { collections: s.collections, items: s.items }
      } catch (e) {
        importError = e instanceof Error ? e.message : 'Ophalen mislukt'
      }
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'client.website.settings', entityType: 'client', entityId: id,
      summary: `Website-instellingen bijgewerkt voor ${client.company_name}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      metadata: { platform: patch.website_platform, keyUpdated: !!patch.framer_api_key, cmsEnabled: patch.cms_enabled, imported },
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, imported, importError })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
