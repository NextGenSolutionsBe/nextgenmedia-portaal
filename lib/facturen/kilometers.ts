// Kilometervergoeding op een factuur — pure regels (client-safe, getest in tests/kilometers.test.ts).
//
// Een verplaatsing bestaat uit ritten: van waar naar waar, heen en terug of
// niet, hoeveel keer en (optioneel) op welke dag. De afstand per rit rekent de
// app uit over de weg (lib/facturen/afstand-server.ts) en is altijd aan te
// passen. Samen geeft dat één factuurregel "Kilometervergoeding" met een
// leesbare omschrijving, aantal = totaal km, prijs = tarief per km.

import { hernummer, nieuweRegel, type FactuurRegel } from './regels'

export type Plek = { adres: string; kort?: string | null; lat?: number | null; lon?: number | null }
export type Rit = {
  id: string
  van: Plek
  naar: Plek
  /** Enkele afstand in km (aanpasbaar). */
  km: number | null
  /** Wat de routeplanner gaf (om "aangepast" te tonen). */
  berekend: number | null
  heenEnTerug: boolean
  /** Hoeveel keer deze rit gereden werd (bv. twee shootdagen). */
  keer: number
  datum: string | null
}
export type Verplaatsing = { ritten: Rit[]; tarief: number; btw: number; waarvoor: string | null }

/** Op dit moment € 0,43 per km (instelbaar in Instellingen → Facturatie). */
export const STANDAARD_KM_TARIEF = 0.43
export const KANTOOR_PLEK: Plek = { adres: 'Corda Campus, Kempische Steenweg 293, 3500 Hasselt', kort: 'Corda Campus', lat: 50.953011, lon: 5.349995 }
export const WAARVOOR_VOORSTELLEN = ['contentshoot', 'fotoshoot', 'videoshoot', 'meeting', 'opname'] as const

const rond = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d
const nl = (n: number, d = 1) => n.toLocaleString('nl-BE', { maximumFractionDigits: d })
const DAG = /^\d{4}-\d{2}-\d{2}$/

let teller = 0
const nieuwId = () => `r${Date.now().toString(36)}${(teller++).toString(36)}`

export function nieuweRit(deel: Partial<Rit> = {}): Rit {
  return { id: nieuwId(), van: { adres: '' }, naar: { adres: '' }, km: null, berekend: null, heenEnTerug: true, keer: 1, datum: null, ...deel }
}

/** Totaal km van één rit: enkele afstand × 2 (heen en terug) × aantal keer. */
export function ritTotaal(r: Pick<Rit, 'km' | 'heenEnTerug' | 'keer'>): number {
  const km = Number(r.km) > 0 ? Number(r.km) : 0
  return rond(km * (r.heenEnTerug ? 2 : 1) * Math.max(1, Math.round(Number(r.keer) || 1)))
}

export const totaalKm = (ritten: Rit[]): number => rond(ritten.reduce((s, r) => s + ritTotaal(r), 0))
export const kmBedrag = (v: Pick<Verplaatsing, 'ritten' | 'tarief'>): number => Math.round(totaalKm(v.ritten) * v.tarief * 100) / 100

/** Een korte plaatsnaam uit een adres: "Kempische Steenweg 293, 3500 Hasselt" → "Hasselt". */
export function plaatsUitAdres(adres: string): string {
  const a = adres.trim()
  if (!a) return ''
  if (/corda/i.test(a)) return 'Corda Campus'
  const pc = a.match(/\b\d{4}(?:\s?[A-Z]{2})?\s+([A-Za-zÀ-ÿ'’.\- ]+?)(?:,|$)/)
  if (pc) return pc[1].trim()
  const delen = a.split(',').map((x) => x.trim()).filter(Boolean)
  return (delen.length > 1 ? delen[delen.length - 1] : a).slice(0, 40)
}

export const kortVan = (p: Plek): string => (p.kort ?? '').trim() || plaatsUitAdres(p.adres)

const datumKort = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`
const tariefTekst = (t: number) => `€ ${t.toLocaleString('nl-BE', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}/km`

function trajectTekst(r: Rit): string {
  const keer = r.keer > 1 ? `, ${r.keer} keer` : ''
  return `${kortVan(r.van)} → ${kortVan(r.naar)}${r.heenEnTerug ? ' en terug' : ''}${keer}`
}

/** Titel op de factuur: "Kilometervergoeding" of "Kilometervergoeding contentshoot". */
export function kmTitel(v: Pick<Verplaatsing, 'waarvoor'>): string {
  const w = (v.waarvoor ?? '').trim().replace(/\s+/g, ' ')
  return w ? `Kilometervergoeding ${w.charAt(0).toLowerCase()}${w.slice(1)}`.slice(0, 120) : 'Kilometervergoeding'
}

/**
 * Omschrijving op de factuur. Eén rit: "Verplaatsing Corda Campus → Antwerpen
 * en terug op 13/11: 160 km × € 0,43/km". Meerdere: "Verplaatsingen: A → B
 * en terug (13/11, 160 km); B → C (40 km). Totaal 200 km × € 0,43/km".
 */
export function kmOmschrijving(v: Verplaatsing): string {
  const ritten = v.ritten.filter((r) => ritTotaal(r) > 0)
  const totaal = totaalKm(ritten)
  if (ritten.length === 1) {
    const r = ritten[0]
    return `Verplaatsing ${trajectTekst(r)}${r.datum && DAG.test(r.datum) ? ` op ${datumKort(r.datum)}` : ''}: ${nl(totaal)} km × ${tariefTekst(v.tarief)}`
  }
  const delen = ritten.map((r) => `${trajectTekst(r)} (${[r.datum && DAG.test(r.datum) ? datumKort(r.datum) : null, `${nl(ritTotaal(r))} km`].filter(Boolean).join(', ')})`)
  return `Verplaatsingen: ${delen.join('; ')}. Totaal ${nl(totaal)} km × ${tariefTekst(v.tarief)}`.slice(0, 1000)
}

/** De factuurregel: aantal = totaal km, eenheid km, prijs = tarief, extra kost bovenop het contract. */
export function kmRegelVan(v: Verplaatsing): FactuurRegel {
  return nieuweRegel({
    artikel: kmTitel(v), omschrijving: kmOmschrijving(v), aantal: totaalKm(v.ritten), eenheid: 'km',
    prijs_excl: Math.round(v.tarief * 10000) / 10000, is_extra: true, classificatie: 'doorgerekende_kost',
  }, v.btw)
}

/** Is dit een kilometerregel (eenheid km en "Kilometervergoeding…" als titel)? */
export const isKmRegel = (r: Pick<FactuurRegel, 'eenheid' | 'artikel'>): boolean =>
  String(r.eenheid ?? '').trim().toLowerCase() === 'km' && /^kilometervergoeding/i.test(String(r.artikel ?? '').trim())

/**
 * De kilometerregel op de factuur zetten. "vervang": de eerste bestaande
 * kilometerregel wordt deze (zelfde id en plaats, dus geen dubbele); is er geen,
 * dan komt ze achteraan. "erbij": altijd een extra regel achteraan.
 */
export function zetKmRegel(regels: FactuurRegel[], regel: FactuurRegel, modus: 'vervang' | 'erbij' = 'vervang'): FactuurRegel[] {
  const i = modus === 'vervang' ? regels.findIndex(isKmRegel) : -1
  if (i >= 0) return hernummer(regels.map((r, j) => (j === i ? { ...regel, id: r.id ?? null, volgnr: r.volgnr, dienst: r.dienst } : r)))
  return hernummer([...regels, { ...regel, id: null }])
}

/** De kilometerregel weghalen (de eerste); andere regels blijven. */
export function zonderKmRegel(regels: FactuurRegel[]): FactuurRegel[] {
  const i = regels.findIndex(isKmRegel)
  return i < 0 ? regels : hernummer(regels.filter((_, j) => j !== i))
}

const tekst = (v: unknown, max: number) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, max)
const getal = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}
function leesPlek(raw: unknown): Plek {
  const p = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const lat = getal(p.lat), lon = getal(p.lon)
  const geldig = lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180
  return { adres: tekst(p.adres, 300), kort: tekst(p.kort, 80) || null, lat: geldig ? lat : null, lon: geldig ? lon : null }
}

/** Een bewaarde verplaatsing (jsonb op de factuur) inlezen; onzin valt weg. */
export function leesVerplaatsing(raw: unknown): Verplaatsing | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const ritten = (Array.isArray(o.ritten) ? o.ritten : []).slice(0, 30).map((x) => {
    const r = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>
    const km = getal(r.km), berekend = getal(r.berekend)
    const datum = tekst(r.datum, 10)
    return {
      id: tekst(r.id, 40) || nieuwId(), van: leesPlek(r.van), naar: leesPlek(r.naar),
      km: km !== null && km > 0 ? rond(km, 2) : null, berekend: berekend !== null && berekend > 0 ? rond(berekend, 2) : null,
      heenEnTerug: r.heenEnTerug !== false, keer: Math.min(50, Math.max(1, Math.round(getal(r.keer) ?? 1))), datum: DAG.test(datum) ? datum : null,
    }
  })
  const tarief = getal(o.tarief)
  const btw = getal(o.btw)
  return { ritten, tarief: tarief !== null && tarief > 0 ? tarief : STANDAARD_KM_TARIEF, btw: btw !== null && btw >= 0 && btw <= 100 ? btw : 21, waarvoor: tekst(o.waarvoor, 80) || null }
}

/** Klaar om op de factuur te zetten? Zegt wat er ontbreekt. */
export function controleerVerplaatsing(v: Verplaatsing): string | null {
  if (!v.ritten.length) return 'Voeg minstens één rit toe.'
  for (const [i, r] of v.ritten.entries()) {
    const n = v.ritten.length > 1 ? ` (rit ${i + 1})` : ''
    if (!r.van.adres.trim() || !r.naar.adres.trim()) return `Vul van waar en naar waar in${n}.`
    if (!(Number(r.km) > 0)) return `Vul de afstand in${n}.`
    if (Number(r.km) > 2000) return `Die afstand is wel erg groot${n}. Kijk ze even na.`
  }
  if (!(v.tarief > 0) || v.tarief > 10) return 'Het tarief per km ligt tussen € 0,01 en € 10.'
  if (!(v.btw >= 0 && v.btw <= 100)) return 'De btw ligt tussen 0 en 100%.'
  return null
}
