// Factuurvoorstellen vanuit een contract — pure module (client-safe, getest in tests/factuurvoorstellen.test.ts).
//
// Voorstellen zijn GEEN facturen: ze tellen niet mee in de aflettering, worden
// niet verstuurd en krijgen geen nummer. Pas na expliciete bevestiging maakt de
// server per voorstel een factuuritem "Te factureren" aan.
//
// De app vult niets stil in: ontbrekende afspraken (start dienstverlening,
// frequentie, bedrag, btw, facturatiemoment) moeten eerst bevestigd worden.
// De ondertekendatum is NIET automatisch de start van de dienstverlening.

export type Frequentie = 'eenmalig' | 'maandelijks' | 'tweemaandelijks' | 'kwartaal' | 'halfjaarlijks' | 'jaarlijks'
export const FREQUENTIES: { key: Frequentie; label: string; maanden: number; woord: string }[] = [
  { key: 'maandelijks', label: 'Maandelijks', maanden: 1, woord: 'Maandelijks' },
  { key: 'tweemaandelijks', label: 'Om de 2 maanden', maanden: 2, woord: 'Tweemaandelijks' },
  { key: 'kwartaal', label: 'Per kwartaal', maanden: 3, woord: 'Driemaandelijks' },
  { key: 'halfjaarlijks', label: 'Per half jaar', maanden: 6, woord: 'Halfjaarlijks' },
  { key: 'jaarlijks', label: 'Jaarlijks', maanden: 12, woord: 'Jaarlijks' },
  { key: 'eenmalig', label: 'Eenmalig', maanden: 0, woord: '' },
]
export type FactuurMoment = 'eerste' | 'laatste' | 'start' | 'dag'
export const MOMENTEN: { key: FactuurMoment; label: string }[] = [
  { key: 'eerste', label: 'Eerste dag van de periode' },
  { key: 'laatste', label: 'Laatste dag van de periode' },
  { key: 'start', label: 'Zelfde dag als de start van de dienstverlening' },
  { key: 'dag', label: 'Vaste dag van de maand' },
]

export type Afspraken = {
  dienst: string
  klant: string
  /** Start van de dienstverlening 'YYYY-MM-DD' (≠ ondertekendatum). */
  start: string | null
  frequentie: Frequentie | null
  /** Contractduur in maanden (niet nodig bij eenmalig). */
  duurMaanden: number | null
  /** Bedrag per periode excl. btw (bij eenmalig: het totaal). */
  bedrag: number | null
  btwPct: number | null
  moment: FactuurMoment | null
  /** Bij moment 'dag': dag van de maand (1–31). */
  dag?: number | null
}

export type Voorstel = {
  /** Periodesleutel: 'YYYY-MM' (begin van de periode) of 'eenmalig'. */
  periode: string
  van: string
  tot: string
  datum: string
  artikel: string
  omschrijving: string
  bedrag_excl: number
  btw_pct: number
  /** Bestaat er al een factuuritem voor (een maand van) deze periode? Dan de omschrijving daarvan. */
  bestaatAl: string | null
}

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const ISO = /^\d{4}-\d{2}-\d{2}$/
const ym = (d: string) => d.slice(0, 7)
export function maandPlus(m: string, n: number): string { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm - 1 + n, 1)); return d.toISOString().slice(0, 7) }
const laatsteDag = (m: string) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm, 0)).getUTCDate() }
const dagIn = (m: string, dag: number) => `${m}-${String(Math.min(Math.max(1, dag), laatsteDag(m))).padStart(2, '0')}`
const maandNaam = (m: string) => `${MAANDEN[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
const kleineEerste = (s: string) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)

/** Leesbare periode: "november 2026" of "november 2026 – januari 2027". */
export function periodeLabel(van: string, aantalMaanden: number): string {
  if (aantalMaanden <= 1) return maandNaam(van)
  const tot = maandPlus(van, aantalMaanden - 1)
  return van.slice(0, 4) === tot.slice(0, 4) ? `${MAANDEN[Number(van.slice(5, 7)) - 1]} – ${maandNaam(tot)}` : `${maandNaam(van)} – ${maandNaam(tot)}`
}

/** Wat ontbreekt nog vóór er voorstellen gemaakt kunnen worden? */
export function ontbrekend(a: Afspraken): string[] {
  const f: string[] = []
  if (!a.dienst.trim()) f.push('dienst of pakket')
  if (!a.frequentie) f.push('facturatiefrequentie')
  if (!a.start || !ISO.test(a.start)) f.push('start van de dienstverlening')
  if (a.frequentie && a.frequentie !== 'eenmalig' && !(a.duurMaanden && a.duurMaanden > 0)) f.push('contractduur')
  if (!(a.bedrag !== null && a.bedrag > 0)) f.push(a.frequentie === 'eenmalig' ? 'bedrag' : 'bedrag per periode')
  if (a.btwPct === null || !(a.btwPct >= 0 && a.btwPct <= 100)) f.push('btw-tarief')
  if (!a.moment) f.push('facturatiemoment')
  if (a.moment === 'dag' && !(a.dag && a.dag >= 1 && a.dag <= 31)) f.push('dag van de maand')
  return f
}

/**
 * De voorstellen. `bestaand` = maand 'YYYY-MM' (of 'eenmalig') → omschrijving
 * van een bestaand actief factuuritem van dit contract; zo'n periode krijgt
 * `bestaatAl` en wordt standaard niet geselecteerd (geen dubbels).
 */
export function maakVoorstellen(a: Afspraken, bestaand: Record<string, string> = {}): Voorstel[] {
  if (ontbrekend(a).length) return []
  const f = FREQUENTIES.find((x) => x.key === a.frequentie)!
  const start = a.start as string
  const bedrag = Math.round((a.bedrag as number) * 100) / 100
  const btw = a.btwPct as number
  const datumVoor = (vanM: string, totM: string) => a.moment === 'eerste' ? `${vanM}-01` : a.moment === 'laatste' ? dagIn(totM, 31) : a.moment === 'start' ? dagIn(vanM, Number(start.slice(8, 10))) : dagIn(vanM, a.dag as number)
  if (f.maanden === 0) {
    const m = ym(start)
    return [{
      periode: 'eenmalig', van: start, tot: start, datum: datumVoor(m, m), artikel: a.dienst.trim(),
      omschrijving: `${a.dienst.trim()} voor ${a.klant}, conform de overeengekomen dienstverlening.`,
      bedrag_excl: bedrag, btw_pct: btw, bestaatAl: bestaand.eenmalig ?? null,
    }]
  }
  const aantal = Math.ceil((a.duurMaanden as number) / f.maanden)
  const uit: Voorstel[] = []
  for (let i = 0; i < Math.min(aantal, 120); i++) {
    const vanM = maandPlus(ym(start), i * f.maanden)
    const totM = maandPlus(vanM, f.maanden - 1)
    const label = periodeLabel(vanM, f.maanden)
    const maanden = Array.from({ length: f.maanden }, (_, j) => maandPlus(vanM, j))
    uit.push({
      periode: vanM, van: `${vanM}-01`, tot: dagIn(totM, 31), datum: datumVoor(vanM, totM),
      artikel: `${a.dienst.trim()} – ${label}`,
      omschrijving: `${f.woord} ${kleineEerste(a.dienst.trim())} voor ${a.klant} voor ${label}, conform de overeengekomen dienstverlening.`,
      bedrag_excl: bedrag, btw_pct: btw, bestaatAl: maanden.map((m) => bestaand[m]).find(Boolean) ?? null,
    })
  }
  return uit
}

/** Duur in maanden uit het contract (duration_type '12m', of start/einddatum). Null = onbekend. */
export function duurUitContract(durationType: string | null | undefined, start: string | null | undefined, eind: string | null | undefined): number | null {
  const m = String(durationType ?? '').match(/^(\d+)m$/)
  if (m) return Number(m[1])
  if (start && eind && ISO.test(start.slice(0, 10)) && ISO.test(eind.slice(0, 10))) {
    const [y1, m1, d1] = start.slice(0, 10).split('-').map(Number), [y2, m2, d2] = eind.slice(0, 10).split('-').map(Number)
    let n = (y2 - y1) * 12 + (m2 - m1) + (d2 >= d1 - 1 ? 1 : 0)
    if (n <= 0) n = 1
    return n
  }
  return null
}

/** invoice_frequency uit het contract → frequentie; onbekend → null. */
export function frequentieUitContract(v: string | null | undefined, durationType?: string | null): Frequentie | null {
  const s = String(v ?? '').toLowerCase()
  if (['maandelijks', 'monthly', 'maand'].includes(s)) return 'maandelijks'
  if (['kwartaal', 'quarterly', 'per kwartaal', 'driemaandelijks'].includes(s)) return 'kwartaal'
  if (['jaarlijks', 'annual', 'yearly'].includes(s)) return 'jaarlijks'
  if (['halfjaarlijks', 'semi-annual'].includes(s)) return 'halfjaarlijks'
  if (['eenmalig', 'once', 'one_time'].includes(s) || durationType === 'eenmalig') return 'eenmalig'
  return null
}
