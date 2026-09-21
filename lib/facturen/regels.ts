// Factuurregels en totalen — pure module (client-safe, testbaar).
//
// Alle rekenwerk gebeurt in EUROCENTEN (gehele getallen), zodat 979 × 6 of
// 21 % btw nooit een zwevendekommafout oplevert. Naar buiten toe zijn de
// bedragen gewone euro's met twee decimalen.

export type Classificatie = 'dienst' | 'doorgerekende_kost' | 'gemengd'

export type FactuurRegel = {
  id?: string | null
  volgnr: number
  /** Korte naam van het artikel of de dienst, bv. "Social media beheer". */
  artikel: string
  omschrijving: string
  aantal: number
  eenheid: string
  /** Eenheidsprijs excl. btw, in euro. */
  prijs_excl: number
  btw_pct: number
  /** Regelkorting in procent (0–100). */
  korting_pct: number
  /** Extra kost bovenop het contractuele bedrag (kilometers, huur, freelancers, …). */
  is_extra: boolean
  classificatie: Classificatie
  opmerking?: string | null
}

export type Bedragen = { excl: number; btw: number; incl: number }
export type Totalen = Bedragen & {
  contractueel: Bedragen
  extra: Bedragen
  /** Btw per tarief, voor de samenvatting onderaan een factuur. */
  perBtw: { pct: number; excl: number; btw: number }[]
  aantalRegels: number
}

export const EENHEDEN = ['stuk', 'uur', 'dag', 'maand', 'km', 'forfait'] as const

const NUL: Bedragen = { excl: 0, btw: 0, incl: 0 }
const centen = (euro: number): number => Math.round(euro * 100)
const euro = (c: number): number => c / 100

/** Getal uit invoer: accepteert komma of punt; onzin wordt 0. */
export function getal(v: unknown, standaard = 0): number {
  if (v === null || v === undefined || v === '') return standaard
  const n = Number(String(v).trim().replace(/\s|€/g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : standaard
}

/** De centen van één regel: aantal × prijs, min korting, dan btw op het afgeronde exclusieve bedrag. */
function regelCenten(r: Pick<FactuurRegel, 'aantal' | 'prijs_excl' | 'btw_pct' | 'korting_pct'>): { excl: number; btw: number } {
  const bruto = r.aantal * r.prijs_excl
  const netto = bruto * (1 - Math.min(100, Math.max(0, r.korting_pct || 0)) / 100)
  const excl = centen(netto)
  const btw = Math.round(excl * (r.btw_pct || 0) / 100)
  return { excl, btw }
}

export function berekenRegel(r: Pick<FactuurRegel, 'aantal' | 'prijs_excl' | 'btw_pct' | 'korting_pct'>): Bedragen {
  const c = regelCenten(r)
  return { excl: euro(c.excl), btw: euro(c.btw), incl: euro(c.excl + c.btw) }
}

/** Totalen over alle regels, met de splitsing contractueel / extra en de btw per tarief. */
export function berekenTotalen(regels: FactuurRegel[]): Totalen {
  let excl = 0, btw = 0, cExcl = 0, cBtw = 0, eExcl = 0, eBtw = 0
  const per = new Map<number, { excl: number; btw: number }>()
  for (const r of regels) {
    const c = regelCenten(r)
    excl += c.excl; btw += c.btw
    if (r.is_extra) { eExcl += c.excl; eBtw += c.btw } else { cExcl += c.excl; cBtw += c.btw }
    const p = per.get(r.btw_pct) ?? { excl: 0, btw: 0 }
    p.excl += c.excl; p.btw += c.btw; per.set(r.btw_pct, p)
  }
  const b = (e: number, t: number): Bedragen => ({ excl: euro(e), btw: euro(t), incl: euro(e + t) })
  return {
    ...b(excl, btw),
    contractueel: regels.length ? b(cExcl, cBtw) : NUL,
    extra: regels.length ? b(eExcl, eBtw) : NUL,
    perBtw: [...per.entries()].sort((x, y) => x[0] - y[0]).map(([pct, v]) => ({ pct, excl: euro(v.excl), btw: euro(v.btw) })),
    aantalRegels: regels.length,
  }
}

/** Een nieuwe, lege regel (met verstandige standaardwaarden). */
export function nieuweRegel(deel: Partial<FactuurRegel> = {}, btw = 21): FactuurRegel {
  return {
    id: null, volgnr: deel.volgnr ?? 1, artikel: '', omschrijving: '', aantal: 1, eenheid: 'stuk', prijs_excl: 0, btw_pct: btw,
    korting_pct: 0, is_extra: false, classificatie: 'dienst', opmerking: null, ...deel,
  }
}

/** Eén regel die een bestaand totaalbedrag vertegenwoordigt (facturen van vóór de regels). */
export function regelUitBedrag(omschrijving: string, bedragExcl: number, btw: number): FactuurRegel {
  return nieuweRegel({ artikel: omschrijving.slice(0, 80), omschrijving, aantal: 1, eenheid: 'forfait', prijs_excl: Math.round(bedragExcl * 100) / 100 }, btw)
}

/** Volgnummers netjes 1..n na toevoegen, verwijderen of verslepen. */
export const hernummer = (regels: FactuurRegel[]): FactuurRegel[] => regels.map((r, i) => ({ ...r, volgnr: i + 1 }))

export function verplaatsRegel(regels: FactuurRegel[], van: number, naar: number): FactuurRegel[] {
  if (van < 0 || van >= regels.length || naar < 0 || naar >= regels.length || van === naar) return regels
  const kopie = [...regels]
  const [r] = kopie.splice(van, 1)
  kopie.splice(naar, 0, r)
  return hernummer(kopie)
}

export function dupliceerRegel(regels: FactuurRegel[], index: number): FactuurRegel[] {
  const bron = regels[index]
  if (!bron) return regels
  const kopie = [...regels]
  kopie.splice(index + 1, 0, { ...bron, id: null })
  return hernummer(kopie)
}

export function verwijderRegel(regels: FactuurRegel[], index: number): FactuurRegel[] {
  return hernummer(regels.filter((_, i) => i !== index))
}

/**
 * Regels uit onbetrouwbare invoer (formulier, API, jsonb) normaliseren.
 * Lege regels (zonder artikel én omschrijving) vallen weg; lege omschrijving
 * krijgt het artikel als tekst en omgekeerd.
 */
export function normaliseerRegels(input: unknown, btwStandaard = 21): FactuurRegel[] {
  if (!Array.isArray(input)) return []
  const uit: FactuurRegel[] = []
  for (const raw of input as Record<string, unknown>[]) {
    if (!raw || typeof raw !== 'object') continue
    const artikel = String(raw.artikel ?? '').trim().slice(0, 120)
    const omschrijving = String(raw.omschrijving ?? '').trim().slice(0, 1000)
    if (!artikel && !omschrijving) continue
    const klass = ['dienst', 'doorgerekende_kost', 'gemengd'].includes(String(raw.classificatie)) ? (raw.classificatie as Classificatie) : 'dienst'
    uit.push({
      id: typeof raw.id === 'string' && raw.id ? raw.id : null,
      volgnr: uit.length + 1,
      artikel: artikel || omschrijving.slice(0, 120),
      omschrijving: omschrijving || artikel,
      aantal: Math.max(0, getal(raw.aantal, 1)),
      eenheid: String(raw.eenheid ?? 'stuk').trim().slice(0, 20) || 'stuk',
      prijs_excl: Math.round(getal(raw.prijs_excl, 0) * 100) / 100,
      btw_pct: Math.min(100, Math.max(0, getal(raw.btw_pct, btwStandaard))),
      korting_pct: Math.min(100, Math.max(0, getal(raw.korting_pct, 0))),
      is_extra: raw.is_extra === true || raw.is_extra === 'true',
      classificatie: klass,
      opmerking: raw.opmerking ? String(raw.opmerking).slice(0, 500) : null,
    })
  }
  return uit
}

/** Een leesbaar verschil tussen twee waarden voor de wijzigingshistoriek. */
export function verschillen(oud: Record<string, unknown>, nieuw: Record<string, unknown>, velden: string[]): { veld: string; oud: string; nieuw: string }[] {
  const uit: { veld: string; oud: string; nieuw: string }[] = []
  const tekst = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))
  for (const v of velden) {
    const a = tekst(oud[v]), b = tekst(nieuw[v])
    if (a !== b) uit.push({ veld: v, oud: a, nieuw: b })
  }
  return uit
}
