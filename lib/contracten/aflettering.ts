// Aflettering contract ↔ facturen — pure module (client-safe, getest in tests/contract-aflettering.test.ts).
//
// "Aflettering" = de afgesproken contractwaarde vergelijken met de gekoppelde
// facturen, los van de betaalstatus. Een verstuurde factuur is gefactureerd,
// ook als de klant nog niet betaald heeft.
//
// Alles in EUROCENTEN. Eén bron: de bestaande tabellen invoices, invoice_lines,
// recurring_invoices en recurring_invoice_months — geen kopieën.
//
// Wat telt mee?
//  · Ingepland/opgesteld = alle actieve items (te factureren + verstuurd + betaald).
//  · Al gefactureerd     = verstuurd + betaald (betaald telt één keer, niet bovenop verstuurd).
//  · Geannuleerd en gecrediteerd tellen niet; een factuur met een negatief bedrag
//    (creditnota) vermindert het bedrag vanzelf.
//  · Per factuur telt enkel het deel BINNEN de contractwaarde voor de aflettering;
//    extra kosten / meerwerk (bv. kilometers) worden apart getoond.
//  · Een factuur over meerdere contracten wordt per regel verdeeld
//    (invoice_lines.contract_id) — een bedrag telt nooit bij twee contracten.

import { berekenRegel } from '@/lib/facturen/regels'
import { normaliseerVerzendstatus } from '@/lib/facturen/status'

export type AflStatus = 'te_factureren' | 'verstuurd' | 'betaald' | 'geannuleerd' | 'gecrediteerd'
export const AFL_STATUS_LABEL: Record<AflStatus, string> = {
  te_factureren: 'Te factureren', verstuurd: 'Verstuurd', betaald: 'Betaald', geannuleerd: 'Geannuleerd', gecrediteerd: 'Gecrediteerd',
}
export const isActiefItem = (s: AflStatus) => s === 'te_factureren' || s === 'verstuurd' || s === 'betaald'
export const isGefactureerd = (s: AflStatus) => s === 'verstuurd' || s === 'betaald'

export type AflItem = {
  sleutel: string
  bron: 'invoice' | 'recurring_maand'
  invoice_id: string | null
  recurring_id: string | null
  maand: string | null
  datum: string | null
  referentie: string | null
  omschrijving: string | null
  status: AflStatus
  /** Deel binnen de contractwaarde (centen). */
  contractCent: number
  /** Extra kosten / meerwerk (centen). */
  extraCent: number
  /** Oude factuur zonder regels én zonder contractueel bedrag: verdeling nog te controleren. */
  verdelingOnbekend: boolean
  /** De factuur hoort deels bij een ander contract (verdeling per regel). */
  gedeeld: boolean
}

export type AflBadge = 'waarde_ontbreekt' | 'geen_facturen' | 'onvolledig' | 'volledig_ingepland' | 'volledig_gefactureerd' | 'afwijking'
export const AFL_BADGE: Record<AflBadge, { label: string; cls: string; uitleg: string }> = {
  waarde_ontbreekt: { label: 'Contractwaarde ontbreekt', cls: 'bg-amber-50 text-amber-900 border-amber-300', uitleg: 'Vul de afgesproken totale waarde excl. btw in om te kunnen afletteren.' },
  geen_facturen: { label: 'Geen facturen gekoppeld', cls: 'bg-gray-100 text-gray-700 border-gray-300', uitleg: 'Er hangt nog geen enkele actieve factuur aan dit contract.' },
  onvolledig: { label: 'Facturatie onvolledig ingepland', cls: 'bg-blue-50 text-blue-800 border-blue-200', uitleg: 'De bevestigde factuuritems dekken de contractwaarde nog niet.' },
  volledig_ingepland: { label: 'Volledig ingepland', cls: 'bg-green-50 text-green-800 border-green-300', uitleg: 'De bevestigde contractregels dekken samen de contractwaarde; nog niet alles is gefactureerd.' },
  volledig_gefactureerd: { label: 'Volledig gefactureerd', cls: 'bg-[#166534] text-white border-[#166534]', uitleg: 'De verstuurde en betaalde contractregels dekken de contractwaarde.' },
  afwijking: { label: 'Afwijking controleren', cls: 'bg-red-50 text-red-800 border-red-300', uitleg: 'Er is meer ingepland of gefactureerd dan de contractwaarde, of een verdeling moet nog gecontroleerd worden.' },
}

export type Aflettering = {
  waardeCent: number | null
  ingeplandCent: number
  gefactureerdCent: number
  /** Contractwaarde − al gefactureerd (negatief = overschreden; NIET op nul gezet). */
  nogTeFacturerenCent: number | null
  /** Contractwaarde − ingepland, enkel als er nog iets ontbreekt (> 0). */
  nogInTePlannenCent: number | null
  /** Ingepland − contractwaarde, als er te veel ingepland is (> 0). */
  overschotIngeplandCent: number | null
  extraCent: number
  totaalGekoppeldCent: number
  gecrediteerdCent: number
  aantalActief: number
  teControleren: number
  badges: AflBadge[]
  /** De belangrijkste toestand (voor één badge in een lijst). */
  hoofd: AflBadge
  afwijking: boolean
}

export const cent = (euro: number | null | undefined): number => Math.round((Number(euro) || 0) * 100)
export const euro = (c: number): number => c / 100

export function berekenAflettering(waarde: number | null | undefined, items: AflItem[]): Aflettering {
  const waardeCent = waarde === null || waarde === undefined || Number.isNaN(Number(waarde)) ? null : cent(waarde)
  const actief = items.filter((i) => isActiefItem(i.status))
  const ingeplandCent = actief.reduce((t, i) => t + i.contractCent, 0)
  const gefactureerdCent = actief.filter((i) => isGefactureerd(i.status)).reduce((t, i) => t + i.contractCent, 0)
  const extraCent = actief.reduce((t, i) => t + i.extraCent, 0)
  const gecrediteerdCent = items.filter((i) => i.status === 'gecrediteerd').reduce((t, i) => t + i.contractCent + i.extraCent, 0)
  const teControleren = actief.filter((i) => i.verdelingOnbekend).length
  const nogTeFacturerenCent = waardeCent === null ? null : waardeCent - gefactureerdCent
  const nogInTePlannenCent = waardeCent !== null && waardeCent > ingeplandCent ? waardeCent - ingeplandCent : null
  const overschotIngeplandCent = waardeCent !== null && ingeplandCent > waardeCent ? ingeplandCent - waardeCent : null

  const badges: AflBadge[] = []
  let hoofd: AflBadge
  if (waardeCent === null) {
    badges.push('waarde_ontbreekt')
    if (!actief.length) badges.push('geen_facturen')
    hoofd = 'waarde_ontbreekt'
  } else if (!actief.length && waardeCent !== 0) {
    badges.push('geen_facturen'); hoofd = 'geen_facturen'
  } else if (gefactureerdCent >= waardeCent) {
    badges.push('volledig_gefactureerd'); hoofd = 'volledig_gefactureerd'
  } else if (ingeplandCent >= waardeCent) {
    badges.push('volledig_ingepland'); hoofd = 'volledig_ingepland'
  } else {
    badges.push('onvolledig'); hoofd = 'onvolledig'
  }
  const afwijking = teControleren > 0 || (waardeCent !== null && (ingeplandCent > waardeCent || gefactureerdCent > waardeCent))
  if (afwijking) badges.push('afwijking')
  return {
    waardeCent, ingeplandCent, gefactureerdCent, nogTeFacturerenCent, nogInTePlannenCent, overschotIngeplandCent,
    extraCent, totaalGekoppeldCent: ingeplandCent + extraCent, gecrediteerdCent, aantalActief: actief.length, teControleren, badges, hoofd, afwijking,
  }
}

// ── Van ruwe rijen naar items ───────────────────────────────────────────────
export type RuweFactuur = {
  id: string; contract_id: string | null; invoice_date: string | null; description: string | null; status: string | null
  amount_excl: number | string | null; contract_bedrag_excl: number | string | null; betaalstatus?: string | null; betaald_bedrag?: number | string | null
  amount_incl?: number | string | null; extern_factuurnummer?: string | null; reference?: string | null
}
export type RuweRegel = {
  id: string; invoice_id: string | null; recurring_id: string | null; contract_id: string | null; aantal: number | string | null
  prijs_excl: number | string | null; btw_pct: number | string | null; korting_pct: number | string | null; korting_eur?: number | string | null; is_extra: boolean | null
}

const regelCent = (r: RuweRegel) => cent(berekenRegel({ aantal: Number(r.aantal) || 0, prijs_excl: Number(r.prijs_excl) || 0, btw_pct: Number(r.btw_pct) || 0, korting_pct: Number(r.korting_pct) || 0, korting_eur: Number(r.korting_eur) || 0 }).excl)

export function factuurStatus(f: Pick<RuweFactuur, 'status' | 'betaalstatus' | 'betaald_bedrag' | 'amount_incl'>): AflStatus {
  const s = normaliseerVerzendstatus(f.status)
  if (s === 'geannuleerd' || s === 'gecrediteerd') return s
  if (s === 'te_versturen') return 'te_factureren'
  const incl = Number(f.amount_incl) || 0
  const betaald = f.betaalstatus === 'betaald' || (incl > 0 && (Number(f.betaald_bedrag) || 0) >= incl - 0.005)
  return betaald ? 'betaald' : 'verstuurd'
}

/** Het deel van één factuur dat bij dit contract hoort; null = hoort er niet bij. */
export function itemUitFactuur(f: RuweFactuur, regels: RuweRegel[], contractId: string): AflItem | null {
  const eigen = regels.filter((r) => r.invoice_id === f.id)
  const basis = {
    sleutel: `inv:${f.id}`, bron: 'invoice' as const, invoice_id: f.id, recurring_id: null, maand: f.invoice_date ? f.invoice_date.slice(0, 7) : null,
    datum: f.invoice_date ? String(f.invoice_date).slice(0, 10) : null, referentie: f.extern_factuurnummer || f.reference || null,
    omschrijving: f.description, status: factuurStatus(f),
  }
  if (eigen.length) {
    const vanMij = eigen.filter((r) => (r.contract_id ?? f.contract_id) === contractId)
    if (!vanMij.length) return null
    return {
      ...basis,
      contractCent: vanMij.filter((r) => !r.is_extra).reduce((t, r) => t + regelCent(r), 0),
      extraCent: vanMij.filter((r) => r.is_extra).reduce((t, r) => t + regelCent(r), 0),
      verdelingOnbekend: false,
      gedeeld: vanMij.length < eigen.length,
    }
  }
  if (f.contract_id !== contractId) return null
  const totaal = cent(Number(f.amount_excl))
  const bekend = f.contract_bedrag_excl !== null && f.contract_bedrag_excl !== undefined && f.contract_bedrag_excl !== ''
  const contractCent = bekend ? Math.min(totaal, cent(Number(f.contract_bedrag_excl))) : totaal
  return { ...basis, contractCent, extraCent: totaal - contractCent, verdelingOnbekend: !bekend, gedeeld: false }
}

export type RuweReeks = { id: string; contract_id: string | null; description: string | null; start_month: string; end_month: string | null; amount_excl: number | string | null; deleted_at?: string | null }
export type RuweMaand = { recurring_id: string; month: string; status: string | null; amount_excl?: number | string | null; billing_date?: string | null; invoice_id?: string | null; betaald_op?: string | null; verwijderd_op?: string | null; cancelled_at?: string | null; extern_factuurnummer?: string | null }

const maandPlus = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7) }

/**
 * Maandelijkse facturatie van een contract → één item per maand. Tot de
 * eindmaand van de reeks, anders tot de einddatum van het contract; zonder
 * einde tellen enkel de maanden t.e.m. `totMaand` (doorlopend).
 * Een maand met een eigen factuur telt via die factuur (niet dubbel).
 */
export function itemsUitReeks(r: RuweReeks, maanden: RuweMaand[], regels: RuweRegel[], contractEindMaand: string | null, totMaand: string): { items: AflItem[]; doorlopend: boolean } {
  const start = String(r.start_month).slice(0, 7)
  const eind = r.end_month ? String(r.end_month).slice(0, 7) : contractEindMaand
  const tot = eind ?? totMaand
  const eigenRegels = regels.filter((x) => x.recurring_id === r.id)
  const perMaand = (bedrag: number) => {
    if (!eigenRegels.length) return { contractCent: cent(bedrag), extraCent: 0 }
    const c = eigenRegels.filter((x) => !x.is_extra).reduce((t, x) => t + regelCent(x), 0)
    const e = eigenRegels.filter((x) => x.is_extra).reduce((t, x) => t + regelCent(x), 0)
    return { contractCent: c, extraCent: e }
  }
  const items: AflItem[] = []
  for (let m = start, i = 0; m <= tot && i < 120; m = maandPlus(m, 1), i++) {
    const rij = maanden.find((x) => x.recurring_id === r.id && x.month.slice(0, 7) === m)
    if (rij?.invoice_id) continue   // eigen factuur voor deze maand → telt via de factuur
    const status: AflStatus = rij?.verwijderd_op || rij?.cancelled_at || rij?.status === 'geannuleerd' || (r.deleted_at && !rij) ? 'geannuleerd'
      : rij?.status === 'verstuurd' ? (rij.betaald_op ? 'betaald' : 'verstuurd') : 'te_factureren'
    const bedrag = rij?.amount_excl !== null && rij?.amount_excl !== undefined ? Number(rij.amount_excl) : Number(r.amount_excl) || 0
    items.push({
      sleutel: `rec:${r.id}:${m}`, bron: 'recurring_maand', invoice_id: null, recurring_id: r.id, maand: m, datum: rij?.billing_date ? String(rij.billing_date).slice(0, 10) : `${m}-01`,
      referentie: rij?.extern_factuurnummer ?? null, omschrijving: r.description, status, ...perMaand(bedrag), verdelingOnbekend: false, gedeeld: false,
    })
  }
  return { items, doorlopend: !eind }
}
