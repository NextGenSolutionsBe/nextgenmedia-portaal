import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, audit, meld } from '@/lib/personeel/server'
import { beslis, type Beslissing } from '@/lib/personeel/planning'
import { controleerInplanning, werkblokDetails } from '@/lib/personeel/werkblok'
import { isUuid, tekst, uurOf } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/**
 * POST { soort, start?, eind?, reden?, ...werkblok } — een beschikbaarheid behandelen.
 *  · goedkeuren    het hele tijdsblok → werkblok
 *  · gedeeltelijk  een deel van het tijdsblok → werkblok
 *  · afwijzen      geen werkblok
 *  · voorstel      ander begin- en einduur voorstellen (de medewerker aanvaardt of niet)
 * Beschikbaarheid is nooit zelf een planning: enkel hier ontstaat een werkblok,
 * met optioneel klant, project, taak, briefing en locatie.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('goedkeuren'); if (!g.ok) return g.response
    const { admin, persoon } = g
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const { data: a } = await admin.from('personeel_beschikbaarheid').select('*').eq('id', id).maybeSingle()
    if (!a) return NextResponse.json({ error: 'Beschikbaarheid niet gevonden' }, { status: 404 })
    const nu = new Date().toISOString()
    const reden = tekst(b.reden, 1000)
    const dag = String(a.datum).split('-').reverse().join('/')

    if (b.soort === 'voorstel') {
      const s = uurOf(b.start), e = uurOf(b.eind)
      if (!s || !e || e <= s) return NextResponse.json({ error: 'Geef een geldig voorgesteld begin- en einduur.' }, { status: 400 })
      if (a.status !== 'ingediend') return NextResponse.json({ error: 'Deze beschikbaarheid is al behandeld.' }, { status: 409 })
      await admin.from('personeel_beschikbaarheid').update({ voorstel_start: s, voorstel_eind: e, reactie: reden, updated_at: nu }).eq('id', id)
      await audit(admin, { personeel_id: a.personeel_id, entiteit: 'beschikbaarheid', entiteit_id: id, actie: 'uren_voorgesteld', oud: { start: a.start_tijd, eind: a.eind_tijd }, nieuw: { start: s, eind: e }, reden, actor_email: persoon.email, actor_id: persoon.userId })
      await meld(admin, { personeel_id: a.personeel_id, event: 'planning_gewijzigd', titel: 'Voorstel voor je beschikbaarheid', tekst: `Voor ${dag} stellen we ${s}–${e} voor${reden ? ` (${reden})` : ''}. Aanvaard het voorstel in je beschikbaarheidskalender.`, link: '/team/beschikbaarheid' })
      return NextResponse.json({ ok: true })
    }

    const beslissing: Beslissing = b.soort === 'afwijzen' ? { soort: 'afwijzen', reden } : b.soort === 'gedeeltelijk' ? { soort: 'gedeeltelijk', start: String(b.start ?? ''), eind: String(b.eind ?? '') } : { soort: 'goedkeuren' }
    const r = beslis(a, beslissing)
    if (!r.ok) return NextResponse.json({ error: r.fout }, { status: 400 })

    let planningId: string | null = null
    let waarschuwing: string | null = null
    if (r.werkblok) {
      const c = await controleerInplanning(admin, { personeel_id: a.personeel_id, datum: a.datum, start_tijd: r.werkblok.start, eind_tijd: r.werkblok.eind })
      if (!c.ok) return c.response
      waarschuwing = c.waarschuwing
      const { data: pl, error } = await admin.from('personeel_planning').insert({
        personeel_id: a.personeel_id, datum: c.datum, start_tijd: c.start, eind_tijd: c.eind, beschikbaarheid_id: id,
        ...werkblokDetails(b, a.personeel_id), bevestiging: 'te_bevestigen', created_by: persoon.email,
      }).select('id').single()
      if (error) throw new Error(error.message)
      planningId = pl.id
    }
    await admin.from('personeel_beschikbaarheid').update({
      status: r.status, goedgekeurd_start: r.werkblok?.start ?? null, goedgekeurd_eind: r.werkblok?.eind ?? null,
      reactie: reden, planning_id: planningId, beslist_door: persoon.email, beslist_op: nu, updated_at: nu,
    }).eq('id', id)
    await audit(admin, { personeel_id: a.personeel_id, entiteit: 'beschikbaarheid', entiteit_id: id, actie: `beschikbaarheid_${r.status}`, oud: { status: a.status, start: a.start_tijd, eind: a.eind_tijd }, nieuw: { status: r.status, werkblok: r.werkblok, planning_id: planningId }, reden, actor_email: persoon.email, actor_id: persoon.userId })
    if (r.werkblok) {
      await meld(admin, { personeel_id: a.personeel_id, event: 'planning_goedgekeurd', titel: r.status === 'gedeeltelijk' ? 'Je bent gedeeltelijk ingepland — graag bevestigen' : 'Je bent ingepland — graag bevestigen', tekst: `${dag} van ${r.werkblok.start} tot ${r.werkblok.eind}.${reden ? ` ${reden}` : ''} Bevestig in de app of je kunt.`, link: `/team/planning?blok=${planningId}` })
    } else {
      await meld(admin, { personeel_id: a.personeel_id, event: 'planning_afgewezen', titel: 'Je beschikbaarheid werd niet ingepland', tekst: `${dag} ${String(a.start_tijd).slice(0, 5)}–${String(a.eind_tijd).slice(0, 5)}.${reden ? ` Reden: ${reden}` : ''}`, link: '/team/beschikbaarheid' })
    }
    return NextResponse.json({ ok: true, planningId, waarschuwing })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
