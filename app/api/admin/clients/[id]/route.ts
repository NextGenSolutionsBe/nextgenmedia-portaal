import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { revalidatePath } from 'next/cache'
import { validateBtw } from '@/lib/btw'
import { clickupConfigured, deleteList } from '@/lib/clickup'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// Klant-verwijdering ruimt ook storage, auth en (best-effort) ClickUp op.
export const maxDuration = 60

function addMonthsIso(iso: string, months: number): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.toISOString().slice(0, 10)
}

function monthsBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null
  const x = new Date(a.slice(0, 10) + 'T00:00:00Z'), y = new Date(b.slice(0, 10) + 'T00:00:00Z')
  const m = (y.getUTCFullYear() - x.getUTCFullYear()) * 12 + (y.getUTCMonth() - x.getUTCMonth())
  return m >= 1 ? m : null
}

// Strikt admin (voor destructieve acties zoals klant-DELETE).
async function requireAdmin(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' ? user : null
}

// Admin óf actieve werknemer (module-afscherming zit in de middleware).
async function requireStaffLocal(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

// PATCH — update client fields
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const user = await requireStaffLocal(supabase)
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const body = await req.json()
    const admin = createAdminSupabaseClient()

    const patch: Record<string, unknown> = {}
    if (body.company_name !== undefined) patch.company_name = body.company_name
    if (body.contact_name !== undefined) patch.contact_name = body.contact_name || null
    if (body.niche !== undefined) patch.niche = body.niche || null
    if (body.website_url !== undefined) patch.website_url = body.website_url || null
    if (body.customer_since !== undefined) patch.customer_since = body.customer_since || null
    if (body.btw_nummer !== undefined) {
      const v = validateBtw(body.btw_nummer)
      if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
      patch.btw_nummer = v.value || null
    }

    // Update resiliently: drop columns that don't exist yet (customer_since / btw_nummer).
    let { error } = await admin.from('clients').update(patch).eq('id', id)
    while (error) {
      const col = String(error.message ?? '').match(/'([^']+)' column|column "([^"]+)"/)?.[1]
        ?? (/customer_since/i.test(error.message ?? '') ? 'customer_since' : /btw_nummer/i.test(error.message ?? '') ? 'btw_nummer' : null)
      if (col && col in patch) {
        delete patch[col]
        if (Object.keys(patch).length === 0) { error = null; break }
        ;({ error } = await admin.from('clients').update(patch).eq('id', id))
      } else break
    }
    if (error) throw new Error(error.message)

    // Handle service updates
    // IMPORTANT: We update CONFIG only. We never auto-activate services on edit —
    // portal access is gated by client_services.active = true, which is only set
    // by the explicit grant-access endpoint after admin verifies the signed contract.
    // The original POST route creates new services with active = false by default.
    if (body.services !== undefined) {
      const newServices: string[] = Array.isArray(body.services) ? body.services.map(String) : []
      const serviceCfgs: Record<string, { start_month?: string; contract_months?: number }> =
        body.service_configs && typeof body.service_configs === 'object' ? body.service_configs : {}

      // Get existing services (with current active state + config — to preserve both)
      const { data: existingServices, error: exErr } = await admin
        .from('client_services')
        .select('service_slug, active, config')
        .eq('client_id', id)
      if (exErr) throw new Error(exErr.message)

      type Svc = { service_slug: string; active: boolean; config: Record<string, unknown> | null }
      const existingMap = new Map((existingServices ?? []).map((s: Svc) => [s.service_slug, s]))
      const existingSlugs = Array.from(existingMap.keys())

      // 1) REMOVED services: deactivate + mark `removed` in config.
      //    We deactivate, not delete — preserves history/config + can be re-added later.
      const toRemove = existingSlugs.filter((s) => !newServices.includes(s))
      for (const slug of toRemove) {
        const cur = existingMap.get(slug)!
        const { error: e } = await admin.from('client_services')
          .update({ active: false, config: { ...(cur.config ?? {}), removed: true } })
          .eq('client_id', id).eq('service_slug', slug)
        if (e) throw new Error(e.message)
      }

      // 2) Update or insert services in the new list — PRESERVE active state and
      //    MERGE config (other keys, e.g. from the Website card, stay intact).
      for (const slug of newServices) {
        const partial: Record<string, unknown> = slug === 'social-media'
          ? { posts: body.posts_per_month ?? 0, reels: body.reels_per_month ?? 0, stories: body.stories_per_month ?? 0, channels: body.platforms ?? [] }
          : slug === 'webdesign'
          ? { maintenance_included: body.webdesign_maintenance_included ?? false }
          : slug === 'ads'
          ? { budget: body.ads_budget ?? null }
          : {}

        const cur = existingMap.get(slug)
        if (cur) {
          // Existing service: update config ONLY, do NOT touch `active`
          // (admin must explicitly grant/revoke via /grant-access endpoint)
          const config: Record<string, unknown> = { ...(cur.config ?? {}), ...partial }
          delete config.removed
          const { error: e } = await admin.from('client_services').update({ config })
            .eq('client_id', id).eq('service_slug', slug)
          if (e) throw new Error(e.message)
        } else {
          // Brand new service: insert with active = false (consistent with POST route)
          // Admin must explicitly grant access after contract is signed.
          const { error: e } = await admin.from('client_services')
            .insert({ client_id: id, service_slug: slug, active: false, config: partial })
          if (e) throw new Error(e.message)
        }
      }

      // 3) service_contracts: start maand + contractduur per dienst. Bestaat er nog
      //    geen rij (dienst later toegevoegd), dan maken we er een aan zoals bij POST.
      const { data: scRows, error: scErr } = await admin
        .from('service_contracts')
        .select('id, service_slug, model, start_date, end_date, config')
        .eq('client_id', id)
      // Kunnen we de bestaande contracten niet lezen, dan niets aanmaken (anders dubbels).
      if (scErr) throw new Error(scErr.message)
      type ScRow = { id: string; service_slug: string; model: string | null; start_date: string | null; end_date: string | null; config: Record<string, unknown> | null }
      const today = new Date()
      const defaultMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`

      for (const slug of newServices) {
        const rows = ((scRows ?? []) as ScRow[]).filter((r) => r.service_slug === slug)
        // Hoofdcontract per dienst (bij webdesign: het project, niet het onderhoud).
        const main = slug === 'webdesign'
          ? rows.find((r) => r.model === 'webdesign_project') ?? rows.find((r) => r.model !== 'webdesign_maintenance')
          : rows[0]
        const wanted = serviceCfgs[slug] ?? {}
        const monthsRaw = Number(wanted.contract_months)
        const hasMonths = Number.isFinite(monthsRaw) && monthsRaw >= 1 && monthsRaw <= 120
        const startMonth = typeof wanted.start_month === 'string' && /^\d{4}-\d{2}/.test(wanted.start_month)
          ? wanted.start_month.slice(0, 7) : null

        const socialCfg = slug === 'social-media'
          ? { posts: body.posts_per_month ?? 0, reels: body.reels_per_month ?? 0, stories: body.stories_per_month ?? 0, channels: body.platforms ?? [] }
          : null
        const socialGewijzigd = body.posts_per_month !== undefined || body.reels_per_month !== undefined || body.stories_per_month !== undefined

        if (main) {
          const upd: Record<string, unknown> = {}
          // Config samenvoegen: bestaande sleutels (o.a. contract_months) blijven behouden.
          const cfg: Record<string, unknown> = { ...(main.config ?? {}) }
          if (socialCfg && socialGewijzigd) Object.assign(cfg, socialCfg)
          if (slug === 'ads' && body.ads_budget !== undefined) cfg.budget = body.ads_budget ?? null
          if (startMonth || hasMonths) {
            // Zelfde maand als nu → exacte bestaande startdatum behouden.
            const start = startMonth && startMonth !== main.start_date?.slice(0, 7)
              ? `${startMonth}-01`
              : (main.start_date ?? `${startMonth ?? defaultMonth}-01`)
            const months = hasMonths ? Math.round(monthsRaw) : (monthsBetween(main.start_date, main.end_date) ?? 12)
            const end = addMonthsIso(start, months)
            upd.start_date = start
            upd.end_date = end
            upd.renewal_reminder_at = addMonthsIso(end, -1)
            cfg.contract_months = months
          }
          upd.config = cfg
          const { error: e } = await admin.from('service_contracts').update(upd).eq('id', main.id)
          if (e) throw new Error(e.message)
        } else {
          const start = `${startMonth ?? defaultMonth}-01`
          const months = hasMonths ? Math.round(monthsRaw) : 12
          const end = addMonthsIso(start, months)
          const modelMap: Record<string, string> = {
            'social-media':          'social_recurring',
            'webdesign':             'webdesign_project',
            'marketing-consultancy': 'consultancy_hours',
            'grafisch-ontwerp':      'design_project',
            'ads':                   'ads_retainer',
            'foto-video':            'photo_video_project',
          }
          const config: Record<string, unknown> = socialCfg
            ? { ...socialCfg, contract_months: months }
            : slug === 'ads' ? { budget: body.ads_budget ?? null, contract_months: months }
            : { contract_months: months }
          const { error: e } = await admin.from('service_contracts').insert({
            client_id: id, service_slug: slug, model: modelMap[slug] ?? 'design_project',
            status: 'pending', start_date: start, end_date: end,
            renewal_reminder_at: addMonthsIso(end, -1), config,
          })
          if (e) throw new Error(e.message)
        }
      }

      await logAudit({
        action: 'client.services.update',
        entityType: 'client',
        entityId: id,
        summary: `Diensten bijgewerkt (${newServices.join(', ') || 'geen'})`,
        actorUserId: user.id,
        actorEmail: user.email ?? null,
        metadata: { services: newServices, removed: toRemove },
        ...requestMeta(req),
      })
    }

    // Invalidate caches so admin pages refresh
    try {
      revalidatePath('/admin/clients')
      revalidatePath(`/admin/clients/${id}`)
      revalidatePath('/portal')
    } catch { }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — hard delete client and all related data
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const user = await requireAdmin(supabase)
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { confirmed_name } = await req.json()
    if (!confirmed_name) return NextResponse.json({ error: 'Bevestigingsnaam ontbreekt' }, { status: 400 })

    const admin = createAdminSupabaseClient()

    // Verify the confirmed name matches
    const { data: client } = await admin
      .from('clients')
      .select('company_name, owner_user_id, clickup_list_id')
      .eq('id', id)
      .maybeSingle()

    if (!client) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })
    if (client.company_name.trim().toLowerCase() !== confirmed_name.trim().toLowerCase()) {
      return NextResponse.json({ error: 'Bedrijfsnaam komt niet overeen' }, { status: 400 })
    }

    // 1. Fetch contracts before deleting (need paths for storage cleanup)
    const { data: clientContracts } = await admin
      .from('contracts')
      .select('id, pdf_path, signed_pdf_path')
      .eq('client_id', id)

    // 2. Delete contracts (cascades: contract_signatures, contract_events)
    if (clientContracts && clientContracts.length > 0) {
      const contractIds = clientContracts.map(c => c.id)
      await admin.from('contracts').delete().in('id', contractIds)

      // Clean up storage files — best effort
      const paths = clientContracts.flatMap(c =>
        [c.pdf_path, c.signed_pdf_path].filter((p): p is string => !!p)
      )
      if (paths.length > 0) {
        try { await admin.storage.from('contracts').remove(paths) } catch { }
      }
    }

    // 3. Delete other client-related data — best effort (may or may not cascade)
    await Promise.allSettled([
      admin.from('social_content_items').delete().eq('client_id', id),
      admin.from('webdesign_change_requests').delete().eq('client_id', id),
    ])

    // 3b. ClickUp: verwijder de volledige CONTENTKALENDER-lijst van deze klant
    //     (spiegelt de verwijdering — alle gesyncte taken verdwijnen in één call).
    //     Best-effort: mag de klant-verwijdering nooit blokkeren.
    if (clickupConfigured() && client.clickup_list_id) {
      try { await deleteList(client.clickup_list_id as string) } catch { }
    }

    // 4. Delete client record (cascades: client_services, service_contracts, revenue_entries)
    const { error: clientErr } = await admin.from('clients').delete().eq('id', id)
    if (clientErr) throw new Error(clientErr.message)

    // 5. Delete auth user — best effort
    if (client.owner_user_id) {
      try { await admin.auth.admin.deleteUser(client.owner_user_id) } catch { }
    }

    // GDPR: record the erasure (no personal data beyond the company name)
    const meta = requestMeta(req)
    await logAudit({
      action: 'client.delete',
      entityType: 'client',
      entityId: id,
      summary: `Klant "${client.company_name}" en alle gekoppelde gegevens definitief verwijderd`,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      actorRole: 'admin',
      metadata: { company_name: client.company_name },
      ip: meta.ip,
      userAgent: meta.userAgent,
    })

    // 6. Invalidate caches so the clients list updates immediately
    try {
      revalidatePath('/admin/clients')
      revalidatePath('/admin/contracts')
      revalidatePath('/admin')
    } catch { }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
