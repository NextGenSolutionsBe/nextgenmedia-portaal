import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'
import { klantPatch, gewijzigdeVelden, klantNieuw, magKlantVerwijderen } from '@/lib/content/klant-bewerking'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

const VELDEN = 'id, client_id, planned_date, platform, platforms, content_type, title, caption, script, media_notes, status, client_feedback, reviewed_at, created_at, klant_gewijzigd_op, klant_gewijzigd_door, klant_aangemaakt_op'

/** Gedeelde poort: recht social_media.edit + actieve dienst social media. */
async function poort() {
  const g = await requirePortalPermission('social_media', 'edit')
  if (!g.ok) return { fout: g.response }
  const admin = createAdminSupabaseClient()
  const { data: svc } = await admin.from('client_services').select('active').eq('client_id', g.session.clientId).eq('service_slug', 'social-media').maybeSingle()
  if (!svc?.active) return { fout: NextResponse.json({ error: 'Social media staat niet actief voor jouw account.' }, { status: 403 }) }
  return { session: g.session, admin }
}

/** POST — de klant plant zelf een nieuw item in (komt bij ons binnen als concept). */
export async function POST(req: NextRequest) {
  try {
    const p = await poort(); if (p.fout) return p.fout
    const { session, admin } = p
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    let nieuw
    try { nieuw = klantNieuw(body) } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Ongeldige invoer.' }, { status: 400 }) }
    const door = session.name || session.email || 'Klant'
    const nu = new Date().toISOString()
    const { data: rij, error } = await admin.from('social_content_items')
      .insert({ ...nieuw, client_id: session.clientId, status: 'draft', klant_aangemaakt_op: nu, klant_aangemaakt_door: door, klant_gewijzigd_op: nu, klant_gewijzigd_door: door })
      .select(VELDEN).single()
    if (error) throw new Error(error.message)
    await logPortalAction(session, 'portal.content.ingepland', { type: 'social_content_item', id: rij.id }, { req, meta: { titel: nieuw.title, datum: nieuw.planned_date } })
    try { revalidatePath('/portal/social-media'); revalidatePath('/admin/services/social-media') } catch { }
    return NextResponse.json({ ok: true, item: rij })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** DELETE ?id= — enkel een item dat de klant zelf inplande en dat nog concept is. */
export async function DELETE(req: NextRequest) {
  try {
    const p = await poort(); if (p.fout) return p.fout
    const { session, admin } = p
    const id = req.nextUrl.searchParams.get('id') ?? ''
    const { data: item } = await admin.from('social_content_items').select('id, title, status, klant_aangemaakt_op').eq('id', id).eq('client_id', session.clientId).maybeSingle()
    if (!item) return NextResponse.json({ error: 'Item niet gevonden.' }, { status: 404 })
    if (!magKlantVerwijderen(item)) return NextResponse.json({ error: 'Je kunt enkel items verwijderen die je zelf inplande en die nog niet door ons opgepakt zijn.' }, { status: 403 })
    const { error } = await admin.from('social_content_items').delete().eq('id', id).eq('client_id', session.clientId).eq('status', 'draft')
    if (error) throw new Error(error.message)
    await logPortalAction(session, 'portal.content.verwijderd', { type: 'social_content_item', id }, { req, meta: { titel: item.title } })
    try { revalidatePath('/portal/social-media'); revalidatePath('/admin/services/social-media') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * PATCH — de klant past zelf een item van zijn contentplanner aan (titel,
 * caption, script, media-notities, datum, type, kanalen). Vereist:
 *  · portaalrecht social_media.edit (eigenaar altijd);
 *  · een actieve dienst social media;
 *  · het item hoort bij de eigen klant (geresolveerde clientId).
 * Status, ClickUp-velden en interne notities kan de klant nooit wijzigen.
 */
export async function PATCH(req: NextRequest) {
  try {
    const p = await poort(); if (p.fout) return p.fout
    const { session, admin } = p
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const id = String(body.id ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Onbekend item.' }, { status: 400 })

    const { data: oud } = await admin.from('social_content_items').select('id, client_id, title, caption, script, media_notes, planned_date, content_type, platforms, platform').eq('id', id).eq('client_id', session.clientId).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Item niet gevonden.' }, { status: 404 })

    let patch
    try { patch = klantPatch(body) } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Ongeldige invoer.' }, { status: 400 }) }
    const velden = gewijzigdeVelden(oud as Record<string, unknown>, patch)
    if (!velden.length) return NextResponse.json({ ok: true, ongewijzigd: true })

    const door = session.name || session.email || 'Klant'
    const nu = new Date().toISOString()
    const { data: rij, error } = await admin.from('social_content_items')
      .update({ ...patch, klant_gewijzigd_op: nu, klant_gewijzigd_door: door, updated_at: nu })
      .eq('id', id).eq('client_id', session.clientId)
      .select(VELDEN)
      .single()
    if (error) throw new Error(error.message)

    await logPortalAction(session, 'portal.content.gewijzigd', { type: 'social_content_item', id }, {
      req, meta: { velden, oud: Object.fromEntries(velden.map((k) => [k, (oud as Record<string, unknown>)[k] ?? null])), nieuw: Object.fromEntries(velden.map((k) => [k, (patch as Record<string, unknown>)[k] ?? null])) },
    })
    // Ons team ziet de wijziging in het meldingencentrum (lib/notifications.ts) en bij het item.
    try { revalidatePath('/portal/social-media'); revalidatePath('/admin/services/social-media') } catch { }
    return NextResponse.json({ ok: true, item: rij })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
