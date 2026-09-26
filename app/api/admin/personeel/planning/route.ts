import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, audit, meld } from '@/lib/personeel/server'
import { controleerInplanning, werkblokDetails } from '@/lib/personeel/werkblok'
import { dagOf, uuidOf, tekst } from '@/lib/personeel/invoer'
import { dagBrussel, plusDagen } from '@/lib/personeel/tijd'

export const dynamic = 'force-dynamic'

/**
 * GET ?van&tot&personeel_id — alles voor de kalender van de admins: werkblokken,
 * beschikbaarheden en werksessies van alle (of één) medewerker(s), plus de
 * keuzelijsten (medewerkers, klanten, opdrachten).
 */
export async function GET(req: NextRequest) {
  try {
    const g = await eisPersoneel('bekijken'); if (!g.ok) return g.response
    const sp = req.nextUrl.searchParams
    const vandaag = dagBrussel(new Date())
    const van = dagOf(sp.get('van')) ?? plusDagen(vandaag, -7), tot = dagOf(sp.get('tot')) ?? plusDagen(vandaag, 35)
    const pid = uuidOf(sp.get('personeel_id'))
    let qp = g.admin.from('personeel_planning').select('*').gte('datum', van).lte('datum', tot).order('datum').order('start_tijd')
    let qb = g.admin.from('personeel_beschikbaarheid').select('*').gte('datum', van).lte('datum', tot).order('datum').order('start_tijd')
    let qs = g.admin.from('personeel_sessies').select('id, personeel_id, start_at, eind_at, pauzes, status, project, taak, client_id').gte('start_at', `${plusDagen(van, -1)}T00:00:00Z`).lte('start_at', `${plusDagen(tot, 1)}T23:59:59Z`)
    if (pid) { qp = qp.eq('personeel_id', pid); qb = qb.eq('personeel_id', pid); qs = qs.eq('personeel_id', pid) }
    const [planning, beschikbaar, sessies, mensen, klanten, opdrachten] = await Promise.all([
      qp, qb, qs,
      g.admin.from('personeel').select('id, voornaam, achternaam, type, actief, max_uren_dag, max_uren_week, max_uren_maand').order('voornaam'),
      g.admin.from('clients').select('id, company_name').order('company_name').limit(2000),
      g.admin.from('opdrachten').select('id, titel, client_id, status').order('created_at', { ascending: false }).limit(1000),
    ])
    return NextResponse.json({
      van, tot, planning: planning.data ?? [], beschikbaarheid: beschikbaar.data ?? [], sessies: sessies.data ?? [],
      medewerkers: mensen.data ?? [], klanten: klanten.data ?? [], opdrachten: opdrachten.data ?? [],
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST — een medewerker inplannen. Kan enkel binnen een beschikbaarheid die de
 * medewerker zelf opgaf (controleerInplanning). Het werkblok wacht daarna op
 * bevestiging door de medewerker; pas dan gaat het naar ClickUp.
 */
export async function POST(req: NextRequest) {
  try {
    const g = await eisPersoneel('toevoegen'); if (!g.ok) return g.response
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const pid = uuidOf(b.personeel_id)
    if (!pid) return NextResponse.json({ error: 'Kies een medewerker.' }, { status: 400 })
    const c = await controleerInplanning(g.admin, { personeel_id: pid, datum: b.datum, start_tijd: b.start_tijd, eind_tijd: b.eind_tijd })
    if (!c.ok) return c.response
    const details = werkblokDetails(b, pid)
    const rij: Record<string, unknown> = { personeel_id: pid, datum: c.datum, start_tijd: c.start, eind_tijd: c.eind, ...details, bevestiging: 'te_bevestigen', created_by: g.persoon.email }
    if (c.aanbod) rij.beschikbaarheid_id = c.aanbod.id
    const { data, error } = await g.admin.from('personeel_planning').insert(rij).select('id').single()
    if (error) throw new Error(error.message)
    // De beschikbaarheid waarbinnen ingepland werd, staat niet langer "te behandelen".
    if (c.aanbod?.status === 'ingediend') {
      const volledig = c.aanbod.start_tijd.slice(0, 5) === c.start && c.aanbod.eind_tijd.slice(0, 5) === c.eind
      await g.admin.from('personeel_beschikbaarheid').update({
        status: volledig ? 'goedgekeurd' : 'gedeeltelijk', goedgekeurd_start: c.start, goedgekeurd_eind: c.eind,
        planning_id: data.id, beslist_door: g.persoon.email, beslist_op: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', c.aanbod.id).eq('status', 'ingediend')
    }
    await audit(g.admin, { personeel_id: pid, entiteit: 'planning', entiteit_id: data.id, actie: 'ingepland', nieuw: rij, reden: tekst(b.reden, 500), actor_email: g.persoon.email, actor_id: g.persoon.userId })
    await meld(g.admin, { personeel_id: pid, event: 'planning_goedgekeurd', titel: 'Je bent ingepland — graag bevestigen', tekst: `${c.datum.split('-').reverse().join('/')} van ${c.start} tot ${c.eind}${details.taak ? ` — ${details.taak}` : ''}. Bevestig in de app of je kunt.`, link: `/team/planning?blok=${data.id}` })
    return NextResponse.json({ ok: true, id: data.id, waarschuwing: c.waarschuwing })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
