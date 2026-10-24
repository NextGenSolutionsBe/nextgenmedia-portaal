import { safeMessage } from '@/lib/api-error'
import { normaliseerKanalen } from '@/lib/social-platforms'
import { NextRequest, NextResponse } from 'next/server'
import { logContentActiviteit } from '@/lib/content/kalender-beheer-server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { clickupConfigured, deleteTask } from '@/lib/clickup'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// Bulk-verwijderen kan meerdere (gethrottelde) ClickUp-calls vergen.
export const maxDuration = 60

async function currentEmail(): Promise<string | null> {
  try { const supabase = await createClient(); const { data: { user } } = await supabase.auth.getUser(); return user?.email ?? null } catch { return null }
}

async function assertAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Niet ingelogd')
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  if (data?.role !== 'admin' && !(await isActiveStaff(user.id))) throw new Error('Geen toegang')
  return user
}

export async function GET(req: NextRequest) {
  try {
    await assertAdmin()
    const admin = createAdminSupabaseClient()
    const clientId = req.nextUrl.searchParams.get('clientId')
    let query = admin.from('social_content_items').select('*').order('planned_date', { ascending: true })
    if (clientId) query = query.eq('client_id', clientId)
    const { data, error } = await query
    if (error) throw new Error(error.message)
    // Interne notities staan in een aparte tabel (nooit zichtbaar voor de klant).
    const items = (data ?? []) as Record<string, unknown>[]
    const notities = new Map<string, string | null>()
    try {
      const ids = items.map((i) => String(i.id))
      for (let i = 0; i < ids.length; i += 200) {
        const { data: n } = await admin.from('social_content_interne_notities').select('item_id, notitie').in('item_id', ids.slice(i, i + 200))
        for (const r of (n ?? []) as { item_id: string; notitie: string | null }[]) notities.set(r.item_id, r.notitie)
      }
    } catch { /* tabel nog niet gemigreerd */ }
    return NextResponse.json({ items: items.map((i) => ({ ...i, interne_notitie: notities.get(String(i.id)) ?? null })) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    await assertAdmin()
    const admin = createAdminSupabaseClient()
    const body = await req.json()
    const { clientId, title, platforms, platform, content_type, planned_date, caption, script, media_notes, status } = body

    // Zonder geldige klant-koppeling NIET opslaan — voorkomt "wees-items" die
    // daarna nergens getoond worden (leek op verdwenen content).
    if (!clientId || typeof clientId !== 'string') {
      return NextResponse.json({ error: 'Geen klant geselecteerd — kies eerst een klant.' }, { status: 400 })
    }

    // Support both `platforms` (array) and legacy `platform` (string).
    // Normaliseren gebeurt hier, op de server: wat er ook binnenkomt — een oud
    // scherm, de ClickUp-sync, een script — 'instagram' en 'facebook' worden
    // één 'meta'. Zo staat er nooit meer een dubbele regel in de kalender.
    const resolvedPlatforms: string[] = normaliseerKanalen(
      Array.isArray(platforms) && platforms.length > 0 ? platforms : platform,
    )
    const primaryPlatform: string = resolvedPlatforms[0] ?? ''

    const { data: row, error } = await admin
      .from('social_content_items')
      .insert({
        client_id: clientId,
        title, platform: primaryPlatform, platforms: resolvedPlatforms,
        content_type, planned_date,
        caption: caption || null,
        script: script || null,
        media_notes: media_notes || null,
        status: status || 'draft',
      })
      .select('id')
      .single()
    if (error) throw new Error(error.message)
    await logContentActiviteit(admin, { item_id: row.id, client_id: clientId, door: (await currentEmail()) ?? null, rol: 'nextgenmedia', actie: 'aangemaakt', details: { titel: title, datum: planned_date } })
    return NextResponse.json({ id: row.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await assertAdmin()
    const admin = createAdminSupabaseClient()
    const body = await req.json()
    const { id, platforms: rawPlatforms, platform: rawPlatform, interne_notitie, klant_gewijzigd_op: _a, klant_gewijzigd_door: _b, ...rest } = body
    void _a; void _b
    // Interne notitie → aparte tabel, nooit op het item zelf (de klant kan zijn items lezen).
    if (interne_notitie !== undefined) {
      const tekst = typeof interne_notitie === 'string' && interne_notitie.trim() ? interne_notitie.slice(0, 20000) : null
      const { error: ne } = await admin.from('social_content_interne_notities').upsert({ item_id: id, notitie: tekst, gewijzigd_door: user.email ?? null, updated_at: new Date().toISOString() }, { onConflict: 'item_id' })
      if (ne) throw new Error(ne.message)
    }
    const clean: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(rest)) {
      if (v !== undefined) clean[k] = v === '' ? null : v
    }
    // Sync platforms array + primary platform
    if (rawPlatforms !== undefined || rawPlatform !== undefined) {
      const resolvedPlatforms: string[] = normaliseerKanalen(
        Array.isArray(rawPlatforms) && rawPlatforms.length > 0 ? rawPlatforms : rawPlatform,
      )
      clean.platforms = resolvedPlatforms
      clean.platform = resolvedPlatforms[0] ?? null
    }
    if (Object.keys(clean).length) {
      const { data: rij, error } = await admin.from('social_content_items').update(clean).eq('id', id).select('id, client_id').maybeSingle()
      if (error) throw new Error(error.message)
      const velden = Object.keys(clean).filter((k) => k !== 'platform')
      if (rij) await logContentActiviteit(admin, { item_id: rij.id, client_id: rij.client_id, door: user.email ?? null, rol: 'nextgenmedia', actie: velden.every((v) => v === 'planned_date' || v === 'planned_time') ? 'verplaatst' : 'aangepast', details: { velden } })
    } else if (interne_notitie !== undefined) {
      // Enkel de interne notitie: geen klantzichtbare activiteit.
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    await assertAdmin()
    const admin = createAdminSupabaseClient()

    // Twee modi:
    //  - enkel: ?id=<uuid>
    //  - bulk:  body { ids: ["uuid", ...] }
    const singleId = req.nextUrl.searchParams.get('id')

    let bodyIds: string[] | null = null
    try {
      const body = await req.json().catch(() => null)
      if (body && Array.isArray(body.ids) && body.ids.length > 0) {
        bodyIds = body.ids.filter((v: unknown): v is string => typeof v === 'string')
      }
    } catch { /* geen body — enkel-delete via query param */ }

    const targetIds = bodyIds && bodyIds.length > 0 ? bodyIds : singleId ? [singleId] : []
    if (targetIds.length === 0) return NextResponse.json({ error: 'Geen ID(s)' }, { status: 400 })

    // Spiegelt de contentkalender: als een item hier verwijderd wordt, verwijderen
    // we ook de gekoppelde ClickUp-taak. Best-effort per taak — een mislukte
    // ClickUp-delete mag de app-verwijdering nooit blokkeren.
    let clickupDeleted = 0
    let clickupFailed = 0
    if (clickupConfigured()) {
      try {
        const { data: rows } = await admin
          .from('social_content_items')
          .select('clickup_task_id')
          .in('id', targetIds)
        const taskIds = (rows ?? [])
          .map((r) => r.clickup_task_id as string | null)
          .filter((v): v is string => !!v)
        for (const t of taskIds) {
          const ok = await deleteTask(t)
          if (ok) { clickupDeleted++; try { await admin.from('clickup_taak_register').delete().eq('task_id', t) } catch { /* best-effort */ } }
          else clickupFailed++
        }
      } catch { /* kolom mogelijk niet gemigreerd — negeren, app-delete gaat door */ }
    }

    const { error } = await admin.from('social_content_items').delete().in('id', targetIds)
    if (error) throw new Error(error.message)

    try {
      revalidatePath('/admin/services/social-media')
      revalidatePath('/portal/social-media')
    } catch { }

    return NextResponse.json({ ok: true, deleted: targetIds.length, clickupDeleted, clickupFailed })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
