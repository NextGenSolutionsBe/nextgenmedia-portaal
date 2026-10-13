// Goedkeuringsdeadlines voor de contentkalender — pure regels (client-safe),
// getest in tests/content-deadlines.test.ts.
//
// Een deadline geldt voor één of meerdere maanden (YYYY-MM) van één klant:
// "alles van oktober en november moet goedgekeurd zijn tegen 25 september".
// De deadline-DAG telt nog volledig mee (tot 23:59 Brussel). Daarna keuren wij
// manueel goed ("Alles goedkeuren"): wat nog "bij klant" staat; feedback en
// concepten niet. Er wordt nooit automatisch goedgekeurd.

export type Deadline = {
  id: string
  client_id: string
  maanden: string[]
  deadline: string            // YYYY-MM-DD
  status: 'open' | 'afgerond'
  notitie: string | null
  auto_goedgekeurd: number
  afgerond_op: string | null
  /** Gekozen termijn in dagen bij "Goedkeuring aanvragen" (leeg = datum zelf gekozen). */
  termijn_dagen?: number | null
  /** Wanneer de goedkeuring gevraagd werd (opnieuw aanvragen zet dit opnieuw). */
  aangevraagd_op?: string | null
  /** Laatste goedkeuringsmail voor DEZE deadline, en de deadline die erin stond. */
  mail_verstuurd_op?: string | null
  mail_deadline?: string | null
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

// ── Goedkeuring aanvragen: termijn in dagen ─────────────────────────────────

/** Snelle keuzes in "Goedkeuring aanvragen". */
export const TERMIJN_KEUZES = [3, 5, 7] as const

/** Een termijn van 1 tot 60 dagen, anders null. */
export function geldigeTermijn(v: unknown): number | null {
  const n = typeof v === 'string' && v.trim() === '' ? NaN : Number(v)
  return Number.isInteger(n) && n >= 1 && n <= 60 ? n : null
}

/** Vandaag + N kalenderdagen (YYYY-MM-DD). Die laatste dag telt nog volledig mee. */
export function deadlineNaDagen(vandaag: string, dagen: number): string {
  const d = new Date(`${vandaag}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + dagen)
  return d.toISOString().slice(0, 10)
}

/**
 * Stand van de aftelling voor de klant, altijd berekend uit de datum van
 * vandaag (nooit een opgeslagen tekst): nog X dagen, vandaag de laatste dag,
 * of verstreken.
 */
export type AftelStand = { soort: 'dagen'; dagen: number } | { soort: 'vandaag' } | { soort: 'verstreken' }
export function aftelStand(deadline: string, vandaag: string): AftelStand {
  const n = dagenTot(deadline, vandaag)
  if (n > 0) return { soort: 'dagen', dagen: n }
  return n === 0 ? { soort: 'vandaag' } : { soort: 'verstreken' }
}

/** "Nog 5 dagen om goed te keuren" · "Deadline vandaag" · "Goedkeuringstermijn verstreken". */
export function aftelTekst(stand: AftelStand, taal: Taal = 'nl'): string {
  if (stand.soort === 'verstreken') return taal === 'en' ? 'Approval period has ended' : 'Goedkeuringstermijn verstreken'
  if (stand.soort === 'vandaag') return taal === 'en' ? 'Deadline today' : 'Deadline vandaag'
  if (taal === 'en') return stand.dagen === 1 ? '1 day left to approve' : `${stand.dagen} days left to approve`
  return stand.dagen === 1 ? 'Nog 1 dag om goed te keuren' : `Nog ${stand.dagen} dagen om goed te keuren`
}

/** Voor in de mail: "Je hebt nog {aantal_dagen} om alles te bekijken" → "5 dagen" · "1 dag" · "tot vanavond". */
export function aantalDagenTekst(deadline: string, vandaag: string): string {
  const n = dagenTot(deadline, vandaag)
  return n > 1 ? `${n} dagen` : n === 1 ? '1 dag' : n === 0 ? 'tot vanavond' : 'geen dagen meer'
}

/** Voornaam: het eerste woord van de eerste ingevulde naam ("Odger Thewissen " → "Odger"). */
export function voornaam(...namen: (string | null | undefined)[]): string {
  for (const n of namen) { const w = String(n ?? '').trim().split(/\s+/)[0]; if (w) return w }
  return ''
}
