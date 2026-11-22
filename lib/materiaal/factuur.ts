// Materiaalbeheer: een aankoopfactuur lezen (puur, client-safe, getest in
// tests/materiaal-factuur.test.ts). De AI leest de factuur; hier kijken we
// het antwoord na: enkel echte datums, bedragen en een categorie die bestaat.
// Het resultaat is altijd een voorstel dat iemand nakijkt en bewaart.

import { leesGetal } from '@/lib/getal'

export type FactuurToestel = {
  naam: string
  merk: string | null
  model: string | null
  /** Eén serienummer per stuk, als ze op de factuur staan. */
  serienummers: string[]
  /** Een categorie die al bestaat in Materiaalbeheer (exact die naam), of null. */
  categorie: string | null
  aantal: number
  /** Prijs per stuk. */
  prijs_excl: number | null
  prijs_incl: number | null
  omschrijving: string | null
  /** Wat erbij zit (batterij, lader, riem …). */
  inhoud: string[]
  /** De belangrijkste kenmerken van het model. */
  kenmerken: string[]
}

export type FactuurVoorstel = {
  leverancier: string | null
  factuurnummer: string | null
  datum: string | null
  garantie_tot: string | null
  toestellen: FactuurToestel[]
  zekerheid: number
  opmerking: string | null
}

const DAG = /^\d{4}-\d{2}-\d{2}$/
const rond = (x: number) => Math.round(x * 100) / 100
const geldigeDag = (d: string) => DAG.test(d) && new Date(`${d}T12:00:00Z`).toISOString().slice(0, 10) === d
const kort = (v: unknown, max: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '') || null
const lijst = (v: unknown, max = 12) => (Array.isArray(v) ? v : []).map((x) => kort(x, 160)).filter((x): x is string => !!x).slice(0, max)
const bedrag = (v: unknown) => { const n = leesGetal(v); return n !== null && n > 0 && n <= 1_000_000 ? rond(n) : null }

/** Een datum plus een aantal maanden (garantie), op dezelfde dag of de laatste van de maand. */
export function plusMaanden(datum: string, maanden: number): string {
  const [j, m, d] = datum.split('-').map(Number)
  const t = j * 12 + (m - 1) + maanden
  const jj = Math.floor(t / 12), mm = (t % 12) + 1
  const laatste = new Date(Date.UTC(jj, mm, 0)).getUTCDate()
  return `${jj}-${String(mm).padStart(2, '0')}-${String(Math.min(d, laatste)).padStart(2, '0')}`
}

export function leesFactuurVoorstel(text: string, categorieen: string[], vandaag: string): FactuurVoorstel {
  const leeg: FactuurVoorstel = { leverancier: null, factuurnummer: null, datum: null, garantie_tot: null, toestellen: [], zekerheid: 0, opmerking: 'De factuur kon niet gelezen worden.' }
  const a = text.indexOf('{'), z = text.lastIndexOf('}')
  if (a === -1 || z === -1) return leeg
  let p: Record<string, unknown>
  try { p = JSON.parse(text.slice(a, z + 1)) } catch { return leeg }
  if (p.is_factuur === false) return { ...leeg, opmerking: 'Dit lijkt geen factuur of aankoopbewijs.' }
  const datumRuw = typeof p.datum === 'string' ? p.datum.trim() : ''
  const datum = geldigeDag(datumRuw) && datumRuw <= vandaag ? datumRuw : null
  // Garantie: een datum die er staat, of een periode vanaf de factuurdatum. Nooit zelf aannemen.
  const gRuw = typeof p.garantie_tot === 'string' ? p.garantie_tot.trim() : ''
  const gMaanden = Number(p.garantie_maanden)
  const garantie_tot = geldigeDag(gRuw) ? gRuw : datum && Number.isInteger(gMaanden) && gMaanden > 0 && gMaanden <= 120 ? plusMaanden(datum, gMaanden) : null
  const cat = new Map(categorieen.map((c) => [c.toLowerCase(), c]))
  const btw = Number(p.btw)
  const toestellen = (Array.isArray(p.toestellen) ? p.toestellen : []).slice(0, 20).map((r): FactuurToestel | null => {
    if (!r || typeof r !== 'object') return null
    const t = r as Record<string, unknown>
    const naam = kort(t.naam, 160)
    if (!naam) return null
    const aantal = Math.min(20, Math.max(1, Math.round(Number(t.aantal) || 1)))
    let prijs_excl = bedrag(t.prijs_excl)
    const prijs_incl = bedrag(t.prijs_incl)
    // Enkel incl. btw op de factuur en het btw-percentage staat er: zelf terugrekenen.
    if (prijs_excl === null && prijs_incl !== null && Number.isFinite(btw) && btw >= 0 && btw <= 30) prijs_excl = rond(prijs_incl / (1 + btw / 100))
    const catNaam = typeof t.categorie === 'string' ? cat.get(t.categorie.trim().toLowerCase()) ?? null : null
    return {
      naam, merk: kort(t.merk, 120), model: kort(t.model, 120), serienummers: lijst(t.serienummers, 20).map((s) => s.slice(0, 120)),
      categorie: catNaam, aantal, prijs_excl, prijs_incl,
      omschrijving: kort(t.omschrijving, 600), inhoud: lijst(t.inhoud), kenmerken: lijst(t.kenmerken, 8),
    }
  }).filter((t): t is FactuurToestel => !!t)
  const zekerheid = Number(p.zekerheid)
  return {
    leverancier: kort(p.leverancier, 160), factuurnummer: kort(p.factuurnummer, 80), datum, garantie_tot, toestellen,
    zekerheid: Number.isFinite(zekerheid) ? Math.max(0, Math.min(1, zekerheid)) : 0,
    opmerking: toestellen.length ? null : 'Geen toestel gevonden op deze factuur. Vul de gegevens zelf in.',
  }
}

/** Elk stuk apart (twee identieke lenzen = twee items), met zijn eigen serienummer als dat er staat. */
export function perStuk(toestellen: FactuurToestel[]): (FactuurToestel & { serienummer: string | null; volgnummer: number })[] {
  return toestellen.flatMap((t) => Array.from({ length: t.aantal }, (_, i) => ({ ...t, aantal: 1, serienummer: t.serienummers[i] ?? null, volgnummer: i + 1 })))
}

/** Lijstje uit een tekstvak (één per regel, of met komma's als er geen regels zijn). */
export function regelsUit(v: unknown, max = 20): string[] {
  const ruw = Array.isArray(v) ? v.map(String) : String(v ?? '').split(/\r?\n/)
  return ruw.map((x) => x.replace(/^[\s•\-*·]+/, '').replace(/\s+/g, ' ').trim().slice(0, 160)).filter(Boolean).slice(0, max)
}
