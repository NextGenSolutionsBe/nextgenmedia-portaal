import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { logPortalAction } from '@/lib/portal-auth'
import { klantPatch, gewijzigdeVelden, klantNieuw } from '@/lib/content/klant-bewerking'
import { publicatie, STATUS_LABEL, type Status } from '@/lib/content/kalender-beheer'
import { magBewerken, magOvergang, magVerwijderen } from '@/lib/content/kalender-rol'
import { kalenderPoort, geenRecht, logContentActiviteit, leesContentActiviteit } from '@/lib/content/kalender-beheer-server'
import { clickupConfigured, deleteTask } from '@/lib/clickup'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

/**
 * De klant werkt in zijn eigen contentkalender — enkel wat zijn rol toelaat
 * (clients.kalender_rol × eigen portaalrechten, zie lib/content/kalender-rol.ts).
 * Alles wordt hier op de server gecontroleerd en is beperkt tot de eigen klant
 * (geresolveerde clientId); verborgen knoppen alleen volstaan nooit:
 *  · GET ?activiteit=<id>  → activiteit en opmerkingen van een eigen item (wie de kalender mag openen)
 *  · POST                  → item aanmaken (Meewerken, Beheren)
 *  · PATCH {id, …velden}   → inhoud aanpassen; PATCH {id, actie:'status', status, …publicatie} → status
 *  · DELETE ?id=           → verwijderen (Beheren; Meewerken enkel een eigen concept)
 * Publiceren = enkel de status in de kalender; er wordt niets op sociale media gezet.
 */

const VELDEN = 'id, client_id, planned_date, planned_time, platform, platforms, content_type, title, caption, script, media_notes, status, client_feedback, reviewed_at, created_at, published_at, published_url, published_platform, klant_gewijzigd_op, klant_gewijzigd_door, klant_aangemaakt_op'
const vandaagBE = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export async function GET(req: NextRequest) {
  try {
    const p = await kalenderPoort(); if (p.fout) return p.fout
    const { session, admin } = p
    const id = req.nextUrl.searchParams.get('activiteit') ?? ''
    const { data: item } = await admin.from('social_content_items').select('id').eq('id', id).eq('client_id', session.clientId).maybeSingle()
    if (!item) return NextResponse.json({ error: 'Item niet gevonden.' }, { status: 404 })
    return NextResponse.json({ activiteit: await leesContentActiviteit(admin, id) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const p = await kalenderPoort(); if (p.fout) return p.fout
    const { session, admin, door, rechten } = p
    if (!rechten.aanmaken) return geenRecht('Je kan geen content aanmaken in de kalender. Vraag het aan NextGenMedia.')
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    let nieuw
    try { nieuw = klantNieuw(body) } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Ongeldige invoer.' }, { status: 400 }) }
    // Enkel een startstatus die de rol toelaat; al de rest wordt een concept.
    const status: Status = rechten.startStatussen.includes(body.status as Status) ? (body.status as Status) : 'draft'
    const nu = new Date().toISOString()
    const { data: rij, error } = await admin.from('social_content_items')
      .insert({ ...nieuw, client_id: session.clientId, status, klant_aangemaakt_op: nu, klant_aangemaakt_door: door, klant_gewijzigd_op: nu, klant_gewijzigd_door: door })
      .select(VELDEN).single()
    if (error) throw new Error(/planned_time/.test(error.message) ? 'De databank is nog niet bijgewerkt.' : error.message)
    await logContentActiviteit(admin, { item_id: rij.id, client_id: session.clientId, door, rol: 'klant', actie: status === 'scheduled' ? 'aangemaakt en ingepland' : status === 'ready_for_review' ? 'aangemaakt en ter goedkeuring voorgelegd' : 'aangemaakt', details: { titel: nieuw.title, datum: nieuw.planned_date, tijd: nieuw.planned_time ?? null } })
    await logPortalAction(session, 'portal.content.ingepland', { type: 'social_content_item', id: rij.id }, { req, meta: { titel: nieuw.title, datum: nieuw.planned_date, status } })
    try { revalidatePath('/portal/social-media'); revalidatePath('/admin/services/social-media') } catch { }
    return NextResponse.json({ ok: true, item: rij })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const p = await kalenderPoort(); if (p.fout) return p.fout
    const { session, admin, door, rechten } = p
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const id = String(body.id ?? '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Onbekend item.' }, { status: 400 })
    const { data: oud } = await admin.from('social_content_items').select(VELDEN).eq('id', id).eq('client_id', session.clientId).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Item niet gevonden.' }, { status: 404 })
    const nu = new Date().toISOString()

    // ── Status ──
    if (body.actie === 'status') {
      const naar = String(body.status ?? '')
      // Goedkeuren en een aanpassing vragen vanuit "Feedback gevraagd" lopen via de review (met reden).
      if (!magOvergang(rechten, oud.status, naar)) return geenRecht(`Van “${STATUS_LABEL[oud.status as Status] ?? oud.status}” kan je dit item niet naar “${STATUS_LABEL[naar as Status] ?? naar}” zetten.`)
      let extra: Record<string, unknown> = {}
      if (naar === 'published') {
        try { extra = publicatie(body, vandaagBE(), Array.isArray(oud.platforms) && oud.platforms.length ? oud.platforms : [oud.platform].filter(Boolean)) } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Ongeldige publicatiegegevens.' }, { status: 400 }) }
      } else if (oud.status === 'published') extra = { published_at: null, published_url: null, published_platform: null }
      // Voorwaardelijk op de oude status: twee gelijktijdige klikken veranderen niets dubbel.
      const { data: rij, error } = await admin.from('social_content_items').update({ status: naar, ...extra, klant_gewijzigd_op: nu, klant_gewijzigd_door: door, updated_at: nu })
        .eq('id', id).eq('client_id', session.clientId).eq('status', oud.status).select(VELDEN).maybeSingle()
      if (error) throw new Error(error.message)
      if (!rij) return NextResponse.json({ error: 'Dit item werd intussen gewijzigd. Vernieuw de pagina.' }, { status: 409 })
      await logContentActiviteit(admin, { item_id: id, client_id: session.clientId, door, rol: 'klant', actie: naar === 'published' ? 'als gepubliceerd gemarkeerd' : naar === 'ready_for_review' ? 'ter goedkeuring voorgelegd' : `status: ${STATUS_LABEL[naar as Status]}`, details: { van: oud.status, naar, ...(naar === 'published' ? { datum: String(extra.published_at).slice(0, 10), kanaal: extra.published_platform, link: extra.published_url } : {}) } })
      await logPortalAction(session, 'portal.content.status', { type: 'social_content_item', id }, { req, meta: { van: oud.status, naar } })
      try { revalidatePath('/portal/social-media'); revalidatePath('/admin/services/social-media') } catch { }
      return NextResponse.json({ ok: true, item: rij })
    }

    // ── Velden ──
    if (!magBewerken(rechten, oud)) {
      return geenRecht(rechten.bewerkbaar.length ? `Een item met status “${STATUS_LABEL[oud.status as Status] ?? oud.status}” kan je niet meer aanpassen. Plaats een opmerking als er iets moet veranderen.` : 'Je kan de inhoud van de kalender niet aanpassen.')
    }
    let patch
    try { patch = klantPatch(body) } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Ongeldige invoer.' }, { status: 400 }) }
    const velden = gewijzigdeVelden(oud as Record<string, unknown>, patch)
    if (!velden.length) return NextResponse.json({ ok: true, ongewijzigd: true, item: oud })
    const { data: rij, error } = await admin.from('social_content_items')
      .update({ ...patch, klant_gewijzigd_op: nu, klant_gewijzigd_door: door, updated_at: nu })
      .eq('id', id).eq('client_id', session.clientId).select(VELDEN).single()
    if (error) throw new Error(error.message)
    const verplaatst = velden.includes('planned_date') || velden.includes('planned_time')
    await logContentActiviteit(admin, { item_id: id, client_id: session.clientId, door, rol: 'klant', actie: verplaatst && velden.every((v) => v === 'planned_date' || v === 'planned_time') ? 'verplaatst' : 'aangepast', details: { velden, ...(verplaatst ? { datum: rij.planned_date, tijd: rij.planned_time } : {}) } })
    await logPortalAction(session, 'portal.content.gewijzigd', { type: 'social_content_item', id }, {
      req, meta: { velden, oud: Object.fromEntries(velden.map((k) => [k, (oud as Record<string, unknown>)[k] ?? null])), nieuw: Object.fromEntries(velden.map((k) => [k, (patch as Record<string, unknown>)[k] ?? null])) },
    })
    try { revalidatePath('/portal/social-media'); revalidatePath('/admin/services/social-media') } catch { }
    return NextResponse.json({ ok: true, item: rij })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const p = await kalenderPoort(); if (p.fout) return p.fout
    const { session, admin, door, rechten } = p
    const id = req.nextUrl.searchParams.get('id') ?? ''
    const { data: item } = await admin.from('social_content_items').select('id, title, status, planned_date, clickup_task_id, klant_aangemaakt_op').eq('id', id).eq('client_id', session.clientId).maybeSingle()
    if (!item) return NextResponse.json({ error: 'Item niet gevonden.' }, { status: 404 })
    if (!magVerwijderen(rechten, item)) return geenRecht(rechten.verwijderen === 'eigen_concepten' ? 'Je kan enkel een concept verwijderen dat je zelf aanmaakte.' : 'Je kan geen items verwijderen.')
    const { error } = await admin.from('social_content_items').delete().eq('id', id).eq('client_id', session.clientId)
    if (error) throw new Error(error.message)
    // Zelfde opruiming als bij NextGenMedia: de gekoppelde ClickUp-taak verdwijnt mee.
    if (item.clickup_task_id && clickupConfigured()) { try { await deleteTask(item.clickup_task_id); await admin.from('clickup_taak_register').delete().eq('task_id', item.clickup_task_id) } catch { /* best effort */ } }
    await logContentActiviteit(admin, { item_id: id, client_id: session.clientId, door, rol: 'klant', actie: 'verwijderd', details: { titel: item.title, datum: item.planned_date, status: item.status } })
    await logPortalAction(session, 'portal.content.verwijderd', { type: 'social_content_item', id }, { req, meta: { titel: item.title } })
    try { revalidatePath('/portal/social-media'); revalidatePath('/admin/services/social-media') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
