// Contractwaarde voorstellen — pure module (client-safe, getest in tests/contractwaarde-voorstel.test.ts).
//
// De app stelt een contractwaarde VOOR; een mens bevestigt altijd. Bronnen, in
// volgorde: wat de AI uit de contract-pdf haalt (onderdelen met bedrag en
// aantal, de som rekenen we zelf na), anders de gegevens in de app (aantal
// facturen × bedrag, looptijd × bedrag per maand) of de ingevulde velden
// ("3 maanden contract van € 500 per maand" → € 1.500).

export type WaardeVoorstel = {
  waarde: number
  /** Leesbare berekening, bv. "3 maanden × € 500 per maand". */
  berekening: string
  bron: 'ai' | 'gegevens' | 'tekst'
  citaat?: string | null
  /** Waar de mens extra op moet letten (bv. "bedrag incl. btw in het contract"). */
  opmerking?: string | null
}

export type Onderdeel = { omschrijving: string; bedrag_excl: number; aantal: number; eenheid?: string | null }

const rond = (n: number) => Math.round(n * 100) / 100
export const euroKort = (n: number) => `€ ${n.toLocaleString('nl-BE', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`
const maandWoord = (n: number) => (n === 1 ? 'maand' : 'maanden')

// ── Uit de onderdelen die de AI vond: zelf narekenen ─────────────────────────

/** Som van de onderdelen (bedrag × aantal), met de berekening in mensentaal. Onzin valt weg. */
export function waardeUitOnderdelen(lijst: Onderdeel[]): { waarde: number; berekening: string } | null {
  const geldig = lijst.filter((o) => Number.isFinite(o.bedrag_excl) && o.bedrag_excl > 0 && Number.isFinite(o.aantal) && o.aantal > 0 && o.aantal <= 120)
  if (!geldig.length) return null
  const waarde = rond(geldig.reduce((t, o) => t + o.bedrag_excl * o.aantal, 0))
  const stukken = geldig.map((o) => {
    const wat = o.omschrijving?.trim() ? ` (${o.omschrijving.trim().slice(0, 60)})` : ''
    if (o.aantal === 1) return `${euroKort(o.bedrag_excl)}${wat}`
    const eenheid = (o.eenheid ?? '').toLowerCase()
    const per = /maand/.test(eenheid) ? ` ${maandWoord(o.aantal)} × ${euroKort(o.bedrag_excl)} per maand` : /kwartaal/.test(eenheid) ? ` kwartalen × ${euroKort(o.bedrag_excl)}` : /jaar/.test(eenheid) ? ` jaar × ${euroKort(o.bedrag_excl)} per jaar` : ` × ${euroKort(o.bedrag_excl)}`
    return `${o.aantal.toLocaleString('nl-BE')}${per}${wat}`
  })
  return { waarde, berekening: stukken.join(' + ') }
}

// ── Uit de gegevens in de app ────────────────────────────────────────────────

const FREQ_MAANDEN: Record<string, number> = { maandelijks: 1, monthly: 1, tweemaandelijks: 2, kwartaal: 3, quarterly: 3, driemaandelijks: 3, halfjaarlijks: 6, jaarlijks: 12, yearly: 12 }

/** Looptijd in maanden uit het looptijdtype ('3m', '12m') of start/einde. */
export function looptijdMaanden(duration: string | null | undefined, start?: string | null, einde?: string | null): number | null {
  const m = String(duration ?? '').match(/^(\d{1,3})m$/)
  if (m) return Number(m[1])
  if (start && einde && /^\d{4}-\d{2}-\d{2}/.test(start) && /^\d{4}-\d{2}-\d{2}/.test(einde)) {
    const a = new Date(`${start.slice(0, 10)}T12:00:00Z`), b = new Date(`${einde.slice(0, 10)}T12:00:00Z`)
    const maanden = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth()) + (b.getUTCDate() >= a.getUTCDate() - 1 ? 1 : 0)
    return maanden >= 1 && maanden <= 120 ? maanden : null
  }
  return null
}

export type ContractGegevens = {
  duration_type?: string | null; start_date?: string | null; end_date?: string | null
  invoice_frequency?: string | null; expected_invoice_count?: number | null; expected_invoice_amount_excl?: number | null
  field_values?: Record<string, unknown> | null
}

export function waardeUitGegevens(c: ContractGegevens): WaardeVoorstel | null {
  const bedrag = Number(c.expected_invoice_amount_excl)
  const heeftBedrag = c.expected_invoice_amount_excl !== null && c.expected_invoice_amount_excl !== undefined && bedrag > 0
  const aantal = Number(c.expected_invoice_count)
  if (heeftBedrag && aantal >= 1) {
    return { waarde: rond(aantal * bedrag), berekening: aantal === 1 ? `${euroKort(bedrag)} (één factuur)` : `${aantal} facturen × ${euroKort(bedrag)}`, bron: 'gegevens' }
  }
  if (heeftBedrag && (c.duration_type === 'eenmalig' || c.invoice_frequency === 'eenmalig')) {
    return { waarde: rond(bedrag), berekening: `${euroKort(bedrag)} eenmalig`, bron: 'gegevens' }
  }
  const duur = looptijdMaanden(c.duration_type, c.start_date, c.end_date)
  const stap = FREQ_MAANDEN[String(c.invoice_frequency ?? '').toLowerCase()] ?? (duur ? 1 : null)
  if (heeftBedrag && duur && stap) {
    const n = Math.ceil(duur / stap)
    return { waarde: rond(n * bedrag), berekening: stap === 1 ? `${duur} ${maandWoord(duur)} × ${euroKort(bedrag)} per maand` : `${n} facturen × ${euroKort(bedrag)} (${duur} ${maandWoord(duur)}, om de ${stap} maanden)`, bron: 'gegevens' }
  }
  // De ingevulde velden van het contract als tekst ("Prijs per maand: 500", "Looptijd: 3 maanden").
  const velden = c.field_values && typeof c.field_values === 'object'
    ? Object.entries(c.field_values).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => `${k}: ${v}`).join('. ')
    : ''
  const uitTekst = velden ? waardeUitTekst(`${velden}. ${duur ? `Looptijd ${duur} maanden.` : ''}`) : null
  return uitTekst
}

// ── Uit vrije tekst ──────────────────────────────────────────────────────────

const BEDRAG = '(?:€|eur|euro)?\\s*(\\d{1,3}(?:[.\\s]\\d{3})+(?:,\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)\\s*(?:€|eur|euro)?'

/** "1.250,50" / "1250" / "1 250" → 1250.5 */
export function leesEuro(s: string): number | null {
  let t = s.replace(/\s/g, '')
  if (/,\d{1,2}$/.test(t)) t = t.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '')
  const n = Number(t)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * Logisch redeneren op een zin: bedrag per maand/kwartaal/jaar × looptijd,
 * of een uitdrukkelijk totaal. Enkel als beide stukken er echt staan.
 */
export function waardeUitTekst(tekst: string): WaardeVoorstel | null {
  const t = ` ${tekst.replace(/ /g, ' ').toLowerCase()} `
  if (/incl\.?\s*(?:btw|21)/.test(t) && !/excl/.test(t)) {
    // Enkel bedragen incl. btw: niet zelf omrekenen, de mens beslist.
    return null
  }
  const per = t.match(new RegExp(`${BEDRAG}\\s*(?:excl\\.?\\s*(?:btw)?\\s*)?(?:per|\\/|p\\.?|elke|iedere)\\s*(maand|mnd|kwartaal|jaar)\\b`))
  const duurM = t.match(/(\d{1,3})\s*-?\s*(maanden|maand|mnd)(?!\s*(?:per|\/))/)
  const duurJ = t.match(/(\d{1,2})\s*-?\s*(jaar|jaren)\b(?!\s*(?:per|\/))/)
  const duur = duurM ? Number(duurM[1]) : duurJ ? Number(duurJ[1]) * 12 : null
  if (per) {
    const bedrag = leesEuro(per[1])
    const eenheid = per[2] === 'mnd' ? 'maand' : per[2]
    const stap = eenheid === 'maand' ? 1 : eenheid === 'kwartaal' ? 3 : 12
    if (bedrag && duur && duur >= stap && duur <= 120) {
      const n = Math.round(duur / stap)
      const berekening = stap === 1 ? `${duur} ${maandWoord(duur)} × ${euroKort(bedrag)} per maand` : stap === 3 ? `${n} kwartalen × ${euroKort(bedrag)} per kwartaal` : `${n} jaar × ${euroKort(bedrag)} per jaar`
      return { waarde: rond(n * bedrag), berekening, bron: 'tekst', citaat: per[0].trim() }
    }
  }
  const totaal = t.match(new RegExp(`(?:totaal(?:prijs|bedrag)?|totale\\s+(?:prijs|waarde|kostprijs)|in\\s+totaal|globaal\\s+bedrag)\\s*(?:van|:|=)?\\s*(?:excl\\.?\\s*(?:btw)?\\s*)?${BEDRAG}`))
  if (totaal) {
    const bedrag = leesEuro(totaal[1])
    if (bedrag) return { waarde: rond(bedrag), berekening: `${euroKort(bedrag)} totaal`, bron: 'tekst', citaat: totaal[0].trim() }
  }
  return null
}
