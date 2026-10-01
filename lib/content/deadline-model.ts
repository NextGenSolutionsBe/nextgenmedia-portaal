// Goedkeuringsdeadlines voor de contentkalender — pure regels (client-safe),
// getest in tests/content-deadlines.test.ts.
//
// Een deadline geldt voor één of meerdere maanden (YYYY-MM) van één klant:
// "alles van oktober en november moet goedgekeurd zijn tegen 25 september".
// De deadline-DAG telt nog volledig mee (tot 23:59 Brussel). Daarna wordt wat
// nog "bij klant" staat automatisch goedgekeurd; feedback en concepten niet.

export type Deadline = {
  id: string
  client_id: string
  maanden: string[]
  deadline: string            // YYYY-MM-DD
  status: 'open' | 'afgerond'
  notitie: string | null
  auto_goedgekeurd: number
  afgerond_op: string | null
}

export type Tellingen = { bij_klant: number; feedback: number; goedgekeurd: number; concept: number; totaal: number }

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export type Taal = 'nl' | 'en'

export const isMaand = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)
export const isDag = (d: unknown): d is string => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(`${d}T12:00:00Z`))

/** Vandaag in Brussel (YYYY-MM-DD). */
export function vandaagBrussel(nu: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nu)
}

/** "2026-10" → "oktober 2026" (of "October 2026"). */
export function maandLabel(m: string, taal: Taal = 'nl'): string {
  const [j, mm] = m.split('-').map(Number)
  return `${(taal === 'en' ? MONTHS : MAANDEN)[(mm || 1) - 1]} ${j}`
}

/** ["2026-10","2026-11"] → "oktober en november 2026"; over jaren heen met het jaartal per maand. */
export function maandenTekst(maanden: string[], taal: Taal = 'nl'): string {
  const lijst = [...new Set(maanden.filter(isMaand))].sort()
  if (!lijst.length) return ''
  const jaren = new Set(lijst.map((m) => m.slice(0, 4)))
  const namen = jaren.size === 1 ? lijst.map((m) => (taal === 'en' ? MONTHS : MAANDEN)[Number(m.slice(5)) - 1]) : lijst.map((m) => maandLabel(m, taal))
  const en = taal === 'en' ? 'and' : 'en'
  const zin = namen.length === 1 ? namen[0] : `${namen.slice(0, -1).join(', ')} ${en} ${namen[namen.length - 1]}`
  return jaren.size === 1 ? `${zin} ${[...jaren][0]}` : zin
}

/** Dagen tot de deadline: 0 = vandaag is de laatste dag, negatief = verstreken. */
export function dagenTot(deadline: string, vandaag: string): number {
  return Math.round((Date.parse(`${deadline}T12:00:00Z`) - Date.parse(`${vandaag}T12:00:00Z`)) / 86400000)
}

/** Is de deadline voorbij (de deadline-dag zelf telt nog mee)? */
export const isVerstreken = (deadline: string, vandaag: string) => vandaag > deadline

/** Het laatste moment (23:59:59 Brussel) als ISO — voor de aftelklok. */
export function eindeMoment(deadline: string): string {
  // Offset van Brussel op die dag bepalen (zomer/winteruur), zonder bibliotheek.
  const middag = new Date(`${deadline}T12:00:00Z`)
  const uurBrussel = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', hourCycle: 'h23' }).format(middag))
  const offsetUur = uurBrussel - 12
  return new Date(Date.parse(`${deadline}T23:59:59Z`) - offsetUur * 3600000).toISOString()
}

/** Begin en einde (exclusief) van een maand als YYYY-MM-DD, voor de query op planned_date. */
export function maandBereik(m: string): { van: string; tot: string } {
  const [j, mm] = m.split('-').map(Number)
  const volgende = mm === 12 ? `${j + 1}-01` : `${j}-${String(mm + 1).padStart(2, '0')}`
  return { van: `${m}-01`, tot: `${volgende}-01` }
}

/** Invoer controleren: minstens één geldige maand en een geldige datum. */
export function valideerDeadline(r: { maanden?: unknown; deadline?: unknown }): { ok: true; maanden: string[]; deadline: string } | { ok: false; fout: string } {
  const maanden = Array.isArray(r.maanden) ? [...new Set(r.maanden.filter(isMaand))].sort() : []
  if (!maanden.length) return { ok: false, fout: 'Kies minstens één maand.' }
  if (maanden.length > 12) return { ok: false, fout: 'Maximaal 12 maanden per deadline.' }
  if (!isDag(r.deadline)) return { ok: false, fout: 'Kies een geldige deadline.' }
  return { ok: true, maanden, deadline: r.deadline }
}

/** Tellingen per status → het overzicht. */
export function tel(statussen: string[]): Tellingen {
  const t: Tellingen = { bij_klant: 0, feedback: 0, goedgekeurd: 0, concept: 0, totaal: statussen.length }
  for (const s of statussen) {
    if (s === 'ready_for_review') t.bij_klant++
    else if (s === 'changes_requested') t.feedback++
    else if (s === 'approved' || s === 'scheduled' || s === 'published') t.goedgekeurd++
    else t.concept++
  }
  return t
}
