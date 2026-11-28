// Personeel — tijd rekenen. Puur en testbaar.
//
// Sessies bewaren echte tijdstippen (ISO, UTC). Planning en beschikbaarheid
// zijn "muurklok"-tijden op een Belgische kalenderdag ('2026-10-12', '10:00').
// Alles wat een dag of een uur toont, gaat via de tijdzone van de app
// (Europe/Brussels), zodat zomer- en wintertijd nooit een uur verschuiven.

export const TIJDZONE = 'Europe/Brussels'

export type Pauze = { start: string; eind: string | null }

const ms = (iso: string) => new Date(iso).getTime()

/** Kalenderdag in Brussel ('YYYY-MM-DD') van een tijdstip. */
export function dagBrussel(iso: string | Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIJDZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(typeof iso === 'string' ? new Date(iso) : iso)
}

/** Uur in Brussel ('HH:MM'). */
export function uurBrussel(iso: string | Date): string {
  return new Intl.DateTimeFormat('nl-BE', { timeZone: TIJDZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(typeof iso === 'string' ? new Date(iso) : iso)
}

/** Verschil tussen Brussel en UTC op dat moment, in minuten (60 of 120). */
function offsetMinuten(utcMs: number): number {
  const d = new Date(utcMs)
  const delen = new Intl.DateTimeFormat('en-US', { timeZone: TIJDZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d)
  const w = (t: string) => Number(delen.find((p) => p.type === t)?.value)
  const lokaal = Date.UTC(w('year'), w('month') - 1, w('day'), w('hour') % 24, w('minute'))
  return Math.round((lokaal - utcMs) / 60000)
}

/** Een Belgische muurkloktijd (dag + 'HH:MM') als ISO-tijdstip in UTC. */
export function brusselNaarIso(dag: string, uur: string): string {
  const [j, m, d] = dag.split('-').map(Number)
  const [h, mi] = uur.split(':').map(Number)
  const gok = Date.UTC(j, m - 1, d, h, mi)
  // Twee rondes: de offset hangt af van het moment zelf (overgang zomer/winter).
  let t = gok - offsetMinuten(gok) * 60000
  t = gok - offsetMinuten(t) * 60000
  return new Date(t).toISOString()
}

export const isDag = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)
export const isUur = (s: unknown): s is string => typeof s === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(s)
export const minutenVanUur = (u: string) => { const [h, m] = u.slice(0, 5).split(':').map(Number); return h * 60 + m }
export const uurVanMinuten = (n: number) => `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`
export const kortUur = (u: string | null | undefined) => (u ? u.slice(0, 5) : '')

/** Pauzeduur in minuten; een lopende pauze telt tot `nu`. */
export function pauzeMinuten(pauzes: Pauze[] | null | undefined, nu: Date = new Date()): number {
  let totaal = 0
  for (const p of pauzes ?? []) {
    const eind = p.eind ? ms(p.eind) : nu.getTime()
    totaal += Math.max(0, eind - ms(p.start))
  }
  return Math.round(totaal / 60000)
}

/** Gewerkte minuten: (eind of nu) − start − pauzes. Nooit negatief. */
export function gewerkteMinuten(s: { start_at: string; eind_at: string | null; pauzes?: Pauze[] | null }, nu: Date = new Date()): number {
  const eind = s.eind_at ? ms(s.eind_at) : nu.getTime()
  const bruto = Math.round((eind - ms(s.start_at)) / 60000)
  return Math.max(0, bruto - pauzeMinuten(s.pauzes, s.eind_at ? new Date(s.eind_at) : nu))
}

export const urenVanMinuten = (m: number) => Math.round((m / 60) * 100) / 100
export function duurTekst(minuten: number): string {
  const h = Math.floor(minuten / 60), m = minuten % 60
  return h ? `${h} u ${String(m).padStart(2, '0')}` : `${m} min`
}

/**
 * Controle van een sessie (bij uitklokken of een correctie door een admin).
 * Geeft een Nederlandse foutmelding terug, of null als alles klopt.
 */
export function controleerSessie(s: { start_at: string; eind_at: string | null; pauzes?: Pauze[] | null }, nu: Date = new Date()): string | null {
  const start = ms(s.start_at)
  if (!Number.isFinite(start)) return 'Ongeldig beginuur.'
  if (start > nu.getTime() + 5 * 60000) return 'Het beginuur ligt in de toekomst.'
  if (s.eind_at) {
    const eind = ms(s.eind_at)
    if (!Number.isFinite(eind)) return 'Ongeldig einduur.'
    if (eind <= start) return 'Het einduur moet na het beginuur liggen.'
    if (eind - start > 24 * 3600000) return 'Een sessie kan niet langer dan 24 uur duren.'
  }
  const grens = s.eind_at ? ms(s.eind_at) : nu.getTime()
  for (const p of s.pauzes ?? []) {
    const ps = ms(p.start), pe = p.eind ? ms(p.eind) : null
    if (!Number.isFinite(ps) || ps < start || ps > grens) return 'Een pauze valt buiten de sessie.'
    if (pe !== null && (pe < ps || pe > grens)) return 'Een pauze eindigt buiten de sessie.'
  }
  if (s.eind_at && (s.pauzes ?? []).some((p) => !p.eind)) return 'Er loopt nog een pauze.'
  return null
}

/** Overlappen twee tijdvakken (half-open: [start, eind))? */
export function overlapt(a: { start: number; eind: number }, b: { start: number; eind: number }): boolean {
  return a.start < b.eind && b.start < a.eind
}

/** Overlapt deze sessie met een andere sessie van dezelfde medewerker? */
export function overlaptMetSessies(
  s: { id?: string; start_at: string; eind_at: string | null },
  andere: { id: string; start_at: string; eind_at: string | null; status: string }[],
  nu: Date = new Date(),
): boolean {
  const a = { start: ms(s.start_at), eind: s.eind_at ? ms(s.eind_at) : nu.getTime() }
  return andere.some((o) => o.id !== s.id && o.status !== 'afgekeurd' && overlapt(a, { start: ms(o.start_at), eind: o.eind_at ? ms(o.eind_at) : nu.getTime() }))
}

/** Vergeten uit te klokken? Actieve sessie ouder dan `uur` uur. */
export function isVergeten(s: { status: string; start_at: string }, uur: number, nu: Date = new Date()): boolean {
  return s.status === 'actief' && nu.getTime() - ms(s.start_at) > uur * 3600000
}

// ── Periodes ─────────────────────────────────────────────────────────────────
export type PeriodeSoort = 'dag' | 'week' | 'maand' | 'kwartaal' | 'aangepast'

const plusDagen = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const weekdag = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7
export { plusDagen }

/** Begin- en einddag (inclusief) van een periode rond `anker`. */
export function periodeBereik(soort: PeriodeSoort, anker: string, van?: string, tot?: string): { van: string; tot: string } {
  if (soort === 'dag') return { van: anker, tot: anker }
  if (soort === 'week') { const v = plusDagen(anker, -weekdag(anker)); return { van: v, tot: plusDagen(v, 6) } }
  if (soort === 'maand') {
    const v = `${anker.slice(0, 7)}-01`
    const [j, m] = anker.split('-').map(Number)
    const laatste = new Date(Date.UTC(j, m, 0)).getUTCDate()
    return { van: v, tot: `${anker.slice(0, 7)}-${String(laatste).padStart(2, '0')}` }
  }
  if (soort === 'kwartaal') {
    const [j, m] = anker.split('-').map(Number)
    const q0 = Math.floor((m - 1) / 3) * 3
    const laatste = new Date(Date.UTC(j, q0 + 3, 0)).getUTCDate()
    return { van: `${j}-${String(q0 + 1).padStart(2, '0')}-01`, tot: `${j}-${String(q0 + 3).padStart(2, '0')}-${String(laatste).padStart(2, '0')}` }
  }
  return { van: isDag(van) ? van : anker, tot: isDag(tot) ? tot : anker }
}

/** Alle maanden ('YYYY-MM') die een periode raakt. */
export function maandenIn(van: string, tot: string): string[] {
  const uit: string[] = []
  let [j, m] = van.split('-').map(Number)
  const [je, me] = tot.split('-').map(Number)
  while (j < je || (j === je && m <= me)) { uit.push(`${j}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; j++ } }
  return uit
}
