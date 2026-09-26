// Handmatige factuurreeks voor een contract — pure module (client-safe, testbaar).
//
// De app leest NIETS uit het contract: de medewerker vult zelf in hoeveel
// facturen er komen, voor welk bedrag, vanaf welke datum en met welk interval.
// Deze module rekent enkel de geplande momenten uit die daaruit volgen, zodat
// het scherm een voorbeeld kan tonen vóór er iets wordt aangemaakt.

export type ReeksType = 'eenmalig' | 'meerdere' | 'maandelijks'

export type ReeksInvoer = {
  type: ReeksType
  /** Aantal facturen (eenmalig = 1; maandelijks zonder einde = null → doorlopend). */
  aantal: number | null
  bedrag_excl: number
  btw_pct: number
  /** Eerste geplande factuurdatum 'YYYY-MM-DD'. */
  start_datum: string
  /** Interval in maanden tussen twee facturen (1 = maandelijks, 3 = per kwartaal). */
  interval_maanden: number
  omschrijving: string
  betalingstermijn_dagen: number
}

export type ReeksMoment = { volgnr: number; aantal: number; factuurdatum: string; periode: string; omschrijving: string; bedrag_excl: number; btw_pct: number; bedrag_incl: number }

const ISO = /^\d{4}-\d{2}-\d{2}$/
const rond = (n: number) => Math.round(n * 100) / 100

/** Zelfde dag n maanden later; valt de dag buiten de maand, dan de laatste dag van die maand. */
export function plusMaanden(datum: string, n: number): string {
  const [y, m, d] = datum.split('-').map(Number)
  const eersteVanDoel = new Date(Date.UTC(y, m - 1 + n, 1))
  const laatste = new Date(Date.UTC(eersteVanDoel.getUTCFullYear(), eersteVanDoel.getUTCMonth() + 1, 0)).getUTCDate()
  const dag = Math.min(d, laatste)
  return `${eersteVanDoel.getUTCFullYear()}-${String(eersteVanDoel.getUTCMonth() + 1).padStart(2, '0')}-${String(dag).padStart(2, '0')}`
}

/** Fouten in de invoer; leeg = in orde. */
export function valideerReeks(r: ReeksInvoer): string[] {
  const f: string[] = []
  if (!ISO.test(r.start_datum)) f.push('startdatum ontbreekt')
  if (!(r.bedrag_excl > 0)) f.push('bedrag per factuur ontbreekt')
  if (!(r.btw_pct >= 0 && r.btw_pct <= 100)) f.push('btw-tarief is ongeldig')
  if (!r.omschrijving.trim()) f.push('omschrijving ontbreekt')
  if (r.type === 'eenmalig' && r.aantal !== 1) f.push('een eenmalige factuur heeft aantal 1')
  if (r.type === 'meerdere' && !(Number.isInteger(r.aantal) && (r.aantal as number) >= 2 && (r.aantal as number) <= 60)) f.push('aantal facturen moet tussen 2 en 60 liggen')
  if (r.type === 'maandelijks' && r.aantal !== null && !(Number.isInteger(r.aantal) && (r.aantal as number) >= 1 && (r.aantal as number) <= 60)) f.push('aantal maanden moet tussen 1 en 60 liggen (of leeg voor doorlopend)')
  if (!(Number.isInteger(r.interval_maanden) && r.interval_maanden >= 1 && r.interval_maanden <= 12)) f.push('interval moet 1 tot 12 maanden zijn')
  if (!(r.betalingstermijn_dagen >= 0 && r.betalingstermijn_dagen <= 365)) f.push('betaaltermijn is ongeldig')
  return f
}

/** Doorlopende maandfacturatie wordt geen lijst van facturen maar een terugkerende definitie. */
export const isDoorlopend = (r: ReeksInvoer): boolean => r.type === 'maandelijks' && r.aantal === null

/**
 * De geplande facturen. Bij 'maandelijks' met een einde: één factuur per
 * maand; bij 'meerdere': `aantal` facturen met het gekozen interval.
 * De omschrijving krijgt "termijn i/n" of de maandperiode erbij zodat de
 * facturen uit elkaar te houden zijn.
 */
export function maakReeks(r: ReeksInvoer): ReeksMoment[] {
  if (valideerReeks(r).length || isDoorlopend(r)) return []
  const n = r.type === 'eenmalig' ? 1 : (r.aantal as number)
  const stap = r.type === 'maandelijks' ? 1 : r.interval_maanden
  const uit: ReeksMoment[] = []
  for (let i = 0; i < n; i++) {
    const datum = plusMaanden(r.start_datum, i * stap)
    const periode = datum.slice(0, 7)
    const excl = rond(r.bedrag_excl)
    const btw = rond(excl * r.btw_pct / 100)
    const omschrijving = n === 1 ? r.omschrijving.trim() : `${r.omschrijving.trim()} · ${r.type === 'maandelijks' ? periode : `termijn ${i + 1}/${n}`}`
    uit.push({ volgnr: i + 1, aantal: n, factuurdatum: datum, periode, omschrijving, bedrag_excl: excl, btw_pct: r.btw_pct, bedrag_incl: rond(excl + btw) })
  }
  return uit
}

/** Factuurdag voor een doorlopende maandfacturatie, afgeleid van de startdatum. */
export function factuurdagVan(startDatum: string): 'first' | 'mid' | 'last' {
  const d = Number(startDatum.slice(8, 10))
  if (d <= 5) return 'first'
  if (d >= 12 && d <= 18) return 'mid'
  return 'last'
}

export const reeksTotaal = (m: ReeksMoment[]): { excl: number; incl: number } => ({ excl: rond(m.reduce((t, x) => t + x.bedrag_excl, 0)), incl: rond(m.reduce((t, x) => t + x.bedrag_incl, 0)) })
