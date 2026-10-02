import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, audit, meld } from '@/lib/personeel/server'
import { controleerInplanning, werkblokDetails } from '@/lib/personeel/werkblok'
import { isUuid, tekst, verschillen } from '@/lib/personeel/invoer'
import { syncWerkblokNaarClickup, annuleerWerkblokInClickup } from '@/lib/personeel/planning-clickup'
import { bevestigingVan } from '@/lib/personeel/planning'

export const dynamic = 'force-dynamic'

/** PATCH — een werkblok wijzigen (tijd, klant, project, briefing, werkstatus…). */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    const { data: oud } = await g.admin.from('personeel_planning').select('*').eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Werkblok niet gevonden' }, { status: 404 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const patch: Record<string, unknown> = werkblokDetails(b, oud.personeel_id)
    let waarschuwing: string | null = null
    const tijdGewijzigd = ['datum', 'start_tijd', 'eind_tijd'].some((k) => k in b)
    if (tijdGewijzigd) {
      const c = await controleerInplanning(g.admin, { id, personeel_id: oud.personeel_id, datum: b.datum ?? oud.datum, start_tijd: b.start_tijd ?? oud.start_tijd, eind_tijd: b.eind_tijd ?? oud.eind_tijd })
      if (!c.ok) return c.response
      Object.assign(patch, { datum: c.datum, start_tijd: c.start, eind_tijd: c.eind })
      waarschuwing = c.waarschuwing
      // Ander moment → de medewerker bevestigt opnieuw.
      if (String(c.datum) !== String(oud.datum) || c.start !== String(oud.start_tijd).slice(0, 5) || c.eind !== String(oud.eind_tijd).slice(0, 5)) {
        Object.assign(patch, { bevestiging: 'te_bevestigen', bevestigd_op: null, bevestiging_reden: null })
      }
    }
    if (!Object.keys(patch).length) return NextResponse.json({ ok: true })
    patch.updated_at = new Date().toISOString()
    const { error } = await g.admin.from('personeel_planning').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    const v = verschillen(oud, patch)
    if (v) { delete v.oud.updated_at; delete v.nieuw.updated_at; await audit(g.admin, { personeel_id: oud.personeel_id, entiteit: 'planning', entiteit_id: id, actie: 'werkblok_gewijzigd', oud: v.oud, nieuw: v.nieuw, reden: tekst(b.reden, 500), actor_email: g.persoon.email, actor_id: g.persoon.userId }) }
    if (tijdGewijzigd && v && ('datum' in v.nieuw || 'start_tijd' in v.nieuw || 'eind_tijd' in v.nieuw)) {
      await meld(g.admin, { personeel_id: oud.personeel_id, event: 'planning_gewijzigd', titel: 'Je planning is gewijzigd — graag opnieuw bevestigen', tekst: `Nieuw moment: ${String(patch.datum).split('-').reverse().join('/')} van ${patch.start_tijd} tot ${patch.eind_tijd}.`, link: `/team/planning?blok=${id}` })
    }
    // Bestaat er al een ClickUp-taak, dan volgt die mee (tijd, tekst).
    if (oud.clickup_task_id && oud.status !== 'geannuleerd') await syncWerkblokNaarClickup(g.admin, id)
    return NextResponse.json({ ok: true, waarschuwing })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST { actie: 'clickup' } — het werkblok (opnieuw) naar ClickUp sturen, bv.
 * nadat de medewerker in ClickUp werd toegevoegd. Enkel voor bevestigde blokken.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    const b = (await req.json().catch(() => ({}))) as { actie?: string }
    if (b.actie !== 'clickup') return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    const { data: w } = await g.admin.from('personeel_planning').select('id, status, bevestiging').eq('id', id).maybeSingle()
    if (!w) return NextResponse.json({ error: 'Werkblok niet gevonden' }, { status: 404 })
    if (w.status === 'geannuleerd') return NextResponse.json({ error: 'Dit werkblok is geannuleerd.' }, { status: 409 })
    if (bevestigingVan(w) !== 'bevestigd') return NextResponse.json({ error: 'Pas na bevestiging door de medewerker gaat een werkblok naar ClickUp.' }, { status: 409 })
    const r = await syncWerkblokNaarClickup(g.admin, id)
    if (r.status === 'fout') return NextResponse.json({ error: `ClickUp: ${r.fout}` }, { status: 502 })
    return NextResponse.json({ ok: true, ...r })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * DELETE ?reden — een werkblok annuleren (blijft bewaard met status geannuleerd).
 * DELETE ?definitief=1 — een werkblok volledig verwijderen (bv. per vergissing
 * aangemaakt). Een gekoppelde ClickUp-taak wordt in beide gevallen gesloten.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    const { data: oud } = await g.admin.from('personeel_planning').select('*').eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Werkblok niet gevonden' }, { status: 404 })
    const reden = tekst(req.nextUrl.searchParams.get('reden'), 500)
    if (req.nextUrl.searchParams.get('definitief') === '1') {
      await annuleerWerkblokInClickup(g.admin, oud, false)
      await g.admin.from('personeel_beschikbaarheid').update({ planning_id: null }).eq('planning_id', id)
      await g.admin.from('personeel_sessies').update({ planning_id: null }).eq('planning_id', id) // gelogde uren blijven
      const { error } = await g.admin.from('personeel_planning').delete().eq('id', id)
      if (error) throw new Error(error.message)
      await audit(g.admin, { personeel_id: oud.personeel_id, entiteit: 'planning', entiteit_id: id, actie: 'werkblok_verwijderd', oud, nieuw: null, reden, actor_email: g.persoon.email, actor_id: g.persoon.userId })
      if (oud.status !== 'geannuleerd') await meld(g.admin, { personeel_id: oud.personeel_id, event: 'planning_afgewezen', titel: 'Een werkblok werd geschrapt', tekst: `${String(oud.datum).split('-').reverse().join('/')} ${String(oud.start_tijd).slice(0, 5)}–${String(oud.eind_tijd).slice(0, 5)}${reden ? `: ${reden}` : ''}.`, link: '/team/planning' })
      return NextResponse.json({ ok: true, verwijderd: true })
    }
    await g.admin.from('personeel_planning').update({ status: 'geannuleerd', updated_at: new Date().toISOString() }).eq('id', id)
    await annuleerWerkblokInClickup(g.admin, oud)
    await audit(g.admin, { personeel_id: oud.personeel_id, entiteit: 'planning', entiteit_id: id, actie: 'werkblok_geannuleerd', oud: { status: oud.status }, nieuw: { status: 'geannuleerd' }, reden, actor_email: g.persoon.email, actor_id: g.persoon.userId })
    await meld(g.admin, { personeel_id: oud.personeel_id, event: 'planning_afgewezen', titel: 'Een werkblok werd geannuleerd', tekst: `${String(oud.datum).split('-').reverse().join('/')} ${String(oud.start_tijd).slice(0, 5)}–${String(oud.eind_tijd).slice(0, 5)}${reden ? `: ${reden}` : ''}.`, link: '/team/planning' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
