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
// Zelfde benamingen als in Facturen: verstuurd = "Gefactureerd"; betaald valt daaronder.
export const AFL_STATUS_LABEL: Record<AflStatus, string> = {
  te_factureren: 'Te factureren', verstuurd: 'Gefactureerd', betaald: 'Gefactureerd · betaald', geannuleerd: 'Geannuleerd', gecrediteerd: 'Gecrediteerd',
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
  /** Negatief bedrag = creditnota: vermindert het gefactureerde, telt nooit als gewone factuur. */
  creditnota?: boolean
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
  /** Oorspronkelijke contractwaarde (ongewijzigd). */
  waardeCent: number | null
  /** Geregistreerde verminderingen en crediteringen (contract_waarde_wijzigingen). */
  verminderingCent: number
  /** Effectief uit te voeren = contractwaarde − verminderingen; hierop wordt afgeletterd. */
  effectiefCent: number | null
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

export function berekenAflettering(waarde: number | null | undefined, items: AflItem[], verminderingCent = 0): Aflettering {
  const oorspronkelijkCent = waarde === null || waarde === undefined || Number.isNaN(Number(waarde)) ? null : cent(waarde)
  // Zonder verminderingen is dit exact de contractwaarde (bestaande werking).
  const waardeCent = oorspronkelijkCent === null ? null : oorspronkelijkCent - verminderingCent
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
    waardeCent: oorspronkelijkCent, verminderingCent, effectiefCent: waardeCent, ingeplandCent, gefactureerdCent, nogTeFacturerenCent, nogInTePlannenCent, overschotIngeplandCent,
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
      creditnota: vanMij.reduce((t, r) => t + regelCent(r), 0) < 0,
    }
  }
  if (f.contract_id !== contractId) return null
  const totaal = cent(Number(f.amount_excl))
  const bekend = f.contract_bedrag_excl !== null && f.contract_bedrag_excl !== undefined && f.contract_bedrag_excl !== ''
  const contractCent = bekend ? Math.min(totaal, cent(Number(f.contract_bedrag_excl))) : totaal
  return { ...basis, contractCent, extraCent: totaal - contractCent, verdelingOnbekend: !bekend, gedeeld: false, creditnota: totaal < 0 }
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
export function itemsUitReeks(r: RuweReeks, maanden: RuweMaand[], regels: RuweRegel[], contractEindMaand: string | null, totMaand: string, bestaandeFacturen?: Set<string>): { items: AflItem[]; doorlopend: boolean } {
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
    // Eigen factuur voor deze maand → telt via de factuur. Bestaat die factuur niet
    // (meer), dan telt de maand gewoon zelf — zoals in Facturen (anders verdwijnt ze).
    if (rij?.invoice_id && (!bestaandeFacturen || bestaandeFacturen.has(rij.invoice_id))) continue
    // Dezelfde statusregel als de facturenplanner: ook oude rijen 'gefactureerd'/'betaald' zijn gefactureerd.
    const ruw = normaliseerVerzendstatus(rij?.status)
    const status: AflStatus = rij?.verwijderd_op || rij?.cancelled_at || ruw === 'geannuleerd' || (r.deleted_at && !rij) ? 'geannuleerd'
      : ruw === 'gecrediteerd' ? 'gecrediteerd'
      : ruw === 'verstuurd' ? (rij?.betaald_op || rij?.status === 'betaald' ? 'betaald' : 'verstuurd') : 'te_factureren'
    const bedrag = rij?.amount_excl !== null && rij?.amount_excl !== undefined ? Number(rij.amount_excl) : Number(r.amount_excl) || 0
    items.push({
      sleutel: `rec:${r.id}:${m}`, bron: 'recurring_maand', invoice_id: null, recurring_id: r.id, maand: m, datum: rij?.billing_date ? String(rij.billing_date).slice(0, 10) : `${m}-01`,
      referentie: rij?.extern_factuurnummer ?? null, omschrijving: r.description, status, ...perMaand(bedrag), verdelingOnbekend: false, gedeeld: false, creditnota: bedrag < 0,
    })
  }
  return { items, doorlopend: !eind }
}

// ── Kosten en winst van een contract ────────────────────────────────────────
//
// Dezelfde regel als "Kosten en winst" per factuur (lib/facturen/kosten-winst.ts):
// winst = verkoop excl. btw − directe kosten excl. btw, met de interne kosten
// (invoice_costs) die al aan de gekoppelde facturen en maanden hangen. Enkel
// actieve factuuritems en actieve kosten tellen; een kost zonder kostprijs telt
// niet als € 0 maar maakt de winst "voorlopig".

export type RuweKost = {
  invoice_id: string | null; recurring_id: string | null; maand: string | null; line_id: string | null
  kostprijs_excl: number | string | null; status: string | null
}
export type ItemKosten = { kostenCent: number; aantal: number; zonderPrijs: number }
export type ContractWinst = {
  /** Verkoop excl. btw van alle actieve gekoppelde items (contractdeel + extra kosten). */
  omzetCent: number
  /** Waarvan al gefactureerd (verstuurd + betaald). */
  omzetGefactureerdCent: number
  kostenCent: number
  kostenGefactureerdCent: number
  aantalKosten: number
  /** Kosten zonder kostprijs: winst is dan voorlopig. */
  zonderPrijs: number
  winstCent: number
  /** Winst op wat al gefactureerd is. */
  winstGefactureerdCent: number
  perItem: Record<string, ItemKosten>
}

/**
 * Kosten per item van dit contract. Een kost aan een factuurregel volgt het
 * contract van die regel (verdeling per regel); een kost zonder regel volgt de
 * factuur. Een maandkost (recurring) hoort bij die maand van de reeks.
 */
export function berekenContractWinst(items: AflItem[], kosten: RuweKost[], regelContract: Map<string, string | null>, factuurContract: Map<string, string | null>, contractId: string): ContractWinst {
  const actief = items.filter((i) => isActiefItem(i.status))
  const perItem: Record<string, ItemKosten> = {}
  let omzetCent = 0, omzetGefactureerdCent = 0, kostenCent = 0, kostenGefactureerdCent = 0, aantalKosten = 0, zonderPrijs = 0
  for (const i of actief) {
    const omzet = i.contractCent + i.extraCent
    omzetCent += omzet
    if (isGefactureerd(i.status)) omzetGefactureerdCent += omzet
    const eigen = kosten.filter((k) => {
      if (k.status !== 'actief') return false
      if (i.bron === 'invoice') {
        if (k.invoice_id !== i.invoice_id) return false
        if (k.line_id && regelContract.has(k.line_id)) return (regelContract.get(k.line_id) ?? factuurContract.get(i.invoice_id!) ?? null) === contractId
        return (factuurContract.get(i.invoice_id!) ?? null) === contractId || !i.gedeeld
      }
      return !k.invoice_id && k.recurring_id === i.recurring_id && String(k.maand ?? '').slice(0, 7) === i.maand
    })
    const bekend = eigen.filter((k) => k.kostprijs_excl !== null && k.kostprijs_excl !== undefined && k.kostprijs_excl !== '')
    const c = bekend.reduce((t, k) => t + cent(Number(k.kostprijs_excl)), 0)
    perItem[i.sleutel] = { kostenCent: c, aantal: eigen.length, zonderPrijs: eigen.length - bekend.length }
    kostenCent += c; aantalKosten += eigen.length; zonderPrijs += eigen.length - bekend.length
    if (isGefactureerd(i.status)) kostenGefactureerdCent += c
  }
  return {
    omzetCent, omzetGefactureerdCent, kostenCent, kostenGefactureerdCent, aantalKosten, zonderPrijs,
    winstCent: omzetCent - kostenCent, winstGefactureerdCent: omzetGefactureerdCent - kostenGefactureerdCent, perItem,
  }
}

// ── Verminderingen en creditering ───────────────────────────────────────────
export type WijzigingSoort = 'geannuleerd' | 'gaat_niet_door' | 'niet_afgenomen' | 'verminderd' | 'gecrediteerd'
export const WIJZIGING_LABEL: Record<WijzigingSoort, string> = {
  geannuleerd: 'Onderdeel geannuleerd', gaat_niet_door: 'Prestatie gaat niet door', niet_afgenomen: 'Niet afgenomen door klant',
  verminderd: 'Werk geschrapt of verminderd', gecrediteerd: 'Gecrediteerd',
}
export const isWijzigingSoort = (v: unknown): v is WijzigingSoort => typeof v === 'string' && v in WIJZIGING_LABEL
export type Wijziging = {
  id: string; soort: WijzigingSoort; onderdeel: string | null; bedrag_excl: number; datum: string | null; reden: string | null; notitie: string | null
  invoice_id: string | null; aangemaakt_door: string | null; aangemaakt_op: string; gewijzigd_door: string | null; gewijzigd_op: string | null
  verwijderd_op: string | null; verwijderd_door: string | null
}
/** Som van de actieve (niet verwijderde) verminderingen, in centen. */
export const verminderingVan = (w: Pick<Wijziging, 'bedrag_excl' | 'verwijderd_op'>[]): number => w.filter((x) => !x.verwijderd_op).reduce((t, x) => t + cent(x.bedrag_excl), 0)
