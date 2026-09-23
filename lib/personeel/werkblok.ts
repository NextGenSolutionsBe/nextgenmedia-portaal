import 'server-only'
import { NextResponse } from 'next/server'
import { planningOverlapt, controleerWerkblok, blokMinuten, maxUrenWaarschuwing } from './planning'
import { periodeBereik } from './tijd'
import { isWerkstatus, PRIORITEITEN } from './model'
import { tekst, dagOf, uurOf, uuidOf, linksOf, getal } from './invoer'
import type { Admin } from './server'

/** Briefing- en projectvelden van een werkblok uit een verzoek. */
export function werkblokDetails(b: Record<string, unknown>, personeelId: string): Record<string, unknown> {
  const uit: Record<string, unknown> = {}
  const zet = (k: string, v: unknown) => { if (k in b) uit[k] = v }
  zet('client_id', uuidOf(b.client_id)); zet('opdracht_id', uuidOf(b.opdracht_id))
  zet('project', tekst(b.project, 200)); zet('taak', tekst(b.taak, 500))
  zet('verwachte_duur_min', getal(b.verwachte_duur_min)); zet('deadline', dagOf(b.deadline))
  if ('prioriteit' in b) uit.prioriteit = (PRIORITEITEN as readonly string[]).includes(String(b.prioriteit)) ? b.prioriteit : 'normaal'
  zet('briefing', tekst(b.briefing, 10000)); zet('deliverables', tekst(b.deliverables, 5000))
  if ('links' in b) uit.links = linksOf(b.links, `${personeelId}/`)
  zet('locatie', tekst(b.locatie, 200))
  if ('thuiswerk' in b) uit.thuiswerk = b.thuiswerk === true
  if ('werkstatus' in b && isWerkstatus(b.werkstatus)) uit.werkstatus = b.werkstatus
  return uit
}

/**
 * Controleert tijd en overlap van een werkblok, en geeft een waarschuwing
 * (geen blokkade) als de maximumuren van de medewerker overschreden worden.
 */
export async function controleerInplanning(admin: Admin, w: { id?: string; personeel_id: string; datum: unknown; start_tijd: unknown; eind_tijd: unknown }):
  Promise<{ ok: true; datum: string; start: string; eind: string; waarschuwing: string | null } | { ok: false; response: NextResponse }> {
  const fout = controleerWerkblok(w)
  if (fout) return { ok: false, response: NextResponse.json({ error: fout }, { status: 400 }) }
  const datum = dagOf(w.datum)!, start = uurOf(w.start_tijd)!, eind = uurOf(w.eind_tijd)!
  const maand = periodeBereik('maand', datum), week = periodeBereik('week', datum)
  const van = week.van < maand.van ? week.van : maand.van, tot = week.tot > maand.tot ? week.tot : maand.tot
  const [{ data: bestaand }, { data: p }] = await Promise.all([
    admin.from('personeel_planning').select('id, datum, start_tijd, eind_tijd, status').eq('personeel_id', w.personeel_id).gte('datum', van).lte('datum', tot),
    admin.from('personeel').select('max_uren_dag, max_uren_week, max_uren_maand, actief').eq('id', w.personeel_id).maybeSingle(),
  ])
  if (!p) return { ok: false, response: NextResponse.json({ error: 'Medewerker niet gevonden' }, { status: 404 }) }
  const rijen = (bestaand ?? []) as { id: string; datum: string; start_tijd: string; eind_tijd: string; status: string }[]
  if (planningOverlapt({ id: w.id, datum, start_tijd: start, eind_tijd: eind }, rijen)) return { ok: false, response: NextResponse.json({ error: 'Dit werkblok overlapt met een ander werkblok van deze medewerker.' }, { status: 409 }) }
  const actief = rijen.filter((r) => r.id !== w.id && r.status !== 'geannuleerd')
  const nieuwMin = blokMinuten({ start_tijd: start, eind_tijd: eind })
  const som = (f: (r: { datum: string }) => boolean) => actief.filter(f).reduce((s, r) => s + blokMinuten(r), 0) + nieuwMin
  const waarschuwing = maxUrenWaarschuwing(
    { max_uren_dag: p.max_uren_dag, max_uren_week: p.max_uren_week, max_uren_maand: p.max_uren_maand },
    { dag: som((r) => r.datum === datum), week: som((r) => r.datum >= week.van && r.datum <= week.tot), maand: som((r) => r.datum >= maand.van && r.datum <= maand.tot) },
  )
  return { ok: true, datum, start, eind, waarschuwing }
}
