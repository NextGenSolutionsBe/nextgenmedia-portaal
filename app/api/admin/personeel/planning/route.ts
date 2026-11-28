import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, audit, meld } from '@/lib/personeel/server'
import { controleerInplanning, werkblokDetails } from '@/lib/personeel/werkblok'
import { dagOf, uuidOf, tekst } from '@/lib/personeel/invoer'
import { dagBrussel, plusDagen } from '@/lib/personeel/tijd'
import { clickupTaakIdUit } from '@/lib/clickup'

export const dynamic = 'force-dynamic'

/**
 * GET ?van&tot&personeel_id — alles voor de algemene kalender van de admins:
 * werkblokken en beschikbaarheden van alle (of één) medewerker(s), plus de
 * keuzelijsten (medewerkers met hun kleur, klanten, opdrachten).
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
    if (pid) { qp = qp.eq('personeel_id', pid); qb = qb.eq('personeel_id', pid) }
    const [planning, beschikbaar, mensen, klanten, opdrachten] = await Promise.all([
      qp, qb.in('status', ['ingediend', 'goedgekeurd', 'gedeeltelijk']),
      g.admin.from('personeel').select('id, voornaam, achternaam, type, actief, kleur, max_uren_dag, max_uren_week, max_uren_maand').order('voornaam'),
      g.admin.from('clients').select('id, company_name').order('company_name').limit(2000),
      g.admin.from('opdrachten').select('id, titel, client_id, status').order('created_at', { ascending: false }).limit(1000),
    ])
    return NextResponse.json({
      van, tot, planning: planning.data ?? [], beschikbaarheid: beschikbaar.data ?? [],
      medewerkers: mensen.data ?? [], klanten: klanten.data ?? [], opdrachten: opdrachten.data ?? [],
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST — een medewerker inboeken. Kan enkel binnen een beschikbaarheid die de
 * medewerker zelf opgaf (controleerInplanning). De medewerker krijgt een mail
 * met alle details en bevestigt in de app; pas dan gaat het naar ClickUp.
 *  · groep_id               meerdere mensen op dezelfde opdracht/shoot (één ClickUp-taak)
 *  · clickup_bestaande_taak een bestaande ClickUp-taak (link of id) om aan toe te wijzen
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
    const groep = uuidOf(b.groep_id); if (groep) rij.groep_id = groep
    if (b.clickup_bestaande_taak) {
      const taak = clickupTaakIdUit(b.clickup_bestaande_taak)
      if (!taak) return NextResponse.json({ error: 'Die ClickUp-taak herkennen we niet. Plak de link van de taak (app.clickup.com/t/…).' }, { status: 400 })
      rij.clickup_bestaande_taak = taak
    }
    const { data, error } = await g.admin.from('personeel_planning').insert(rij).select('id').single()
    if (error) throw new Error(error.message)
    await audit(g.admin, { personeel_id: pid, entiteit: 'planning', entiteit_id: data.id, actie: 'ingepland', nieuw: rij, reden: tekst(b.reden, 500), actor_email: g.persoon.email, actor_id: g.persoon.userId })

    // De mail: alles wat de medewerker moet weten om te kunnen zeggen "ik ben er".
    const [{ data: p }, klant, opdracht] = await Promise.all([
      g.admin.from('personeel').select('voornaam').eq('id', pid).maybeSingle(),
      details.client_id ? g.admin.from('clients').select('company_name').eq('id', String(details.client_id)).maybeSingle().then((r) => r.data?.company_name as string | undefined) : Promise.resolve(undefined),
      details.opdracht_id ? g.admin.from('opdrachten').select('titel').eq('id', String(details.opdracht_id)).maybeSingle().then((r) => r.data?.titel as string | undefined) : Promise.resolve(undefined),
    ])
    const wanneer = new Date(`${c.datum}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })
    const links = Array.isArray(details.links) ? (details.links as { url?: string | null }[]).map((l) => l.url).filter(Boolean) : []
    const mailTekst = [
      p?.voornaam ? `Hoi ${p.voornaam},` : 'Hoi,',
      '',
      'NextGenMedia wil je graag inboeken:',
      '',
      `Wanneer: ${wanneer}, ${c.start}–${c.eind}`,
      `Wat: ${details.taak || details.project || 'Werkblok'}`,
      klant ? `Klant: ${klant}` : null,
      opdracht ? `Opdracht: ${opdracht}` : null,
      details.thuiswerk ? 'Waar: thuiswerk' : details.locatie ? `Waar: ${details.locatie}` : null,
      details.briefing ? `\nBriefing:\n${details.briefing}` : null,
      details.deliverables ? `\nWat we verwachten:\n${details.deliverables}` : null,
      links.length ? `\nLinks:\n${links.join('\n')}` : null,
      '',
      'Ga je akkoord met dit moment? Bevestig of laat weten dat je niet kunt via de knop hieronder.',
    ].filter((x) => x !== null).join('\n')
    await meld(g.admin, {
      personeel_id: pid, event: 'planning_goedgekeurd', titel: `NextGenMedia wil je inboeken — ${c.datum.split('-').reverse().join('/')} ${c.start}–${c.eind}`,
      tekst: `${c.datum.split('-').reverse().join('/')} van ${c.start} tot ${c.eind}${details.taak ? ` — ${details.taak}` : ''}. Bevestig in de app of je kunt.`,
      link: `/team/planning?blok=${data.id}`, mail: { tekst: mailTekst, knop: 'Bekijken en bevestigen' },
    })
    return NextResponse.json({ ok: true, id: data.id, waarschuwing: c.waarschuwing })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
