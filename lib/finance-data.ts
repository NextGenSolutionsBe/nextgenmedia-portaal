import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { setterCostByMonth } from '@/lib/sales/setters'
import {
  mergeFiscalSettings, estimateCorporateTax, estimateSocialContribution,
  revenueForMonth, costForMonth, currentMRR, currentRecurringCost, remainingRecurringRevenue,
  type RevenueEntry, type CostEntry, type FiscalSettings,
} from '@/lib/finance'
import { normalizeInvoiceStatus, recurringActiveInMonth, type RecurringInvoice } from '@/lib/invoices'
import { kantoorPerMaand } from '@/lib/kantoor/finance'

/** Factuurregel zoals gebruikt voor de omzetberekening. */
export type InvoiceRow = {
  invoice_month: string | null      // 'YYYY-MM'
  amount_excl: number | null
  status: string | null             // te_factureren | gefactureerd | betaald | geannuleerd
  client_id: string | null
  service_slug: string | null
  /** client = onze omzet; setter_hours/setter_commission = onze kost. */
  kind?: string | null
}

export type FinanceCore = {
  settings: FiscalSettings
  entries: RevenueEntry[]
  costs: CostEntry[]
  invoices: InvoiceRow[]
  clientMap: Map<string, string>
  year: number
  // omzet = FEITELIJKE omzet uit facturen (excl. btw, geannuleerde niet meegeteld).
  // omzetRec/omzetOne blijven de oude prognose-uitsplitsing (legacy-pagina's).
  monthly: { mi: number; omzet: number; omzetInvoiced: number; omzetOpen: number; omzetRec: number; omzetOne: number; kostenManual: number }[]
  omzetFY: number; omzetInvoicedFY: number; omzetOpenFY: number; omzetRecFY: number; omzetOneFY: number
  kostenManualFY: number; ebitdaFY: number
  /** Kost van de appointment setters (uren + commissie), per maand en per jaar. */
  setterPerMonth: number[]; setterCostFY: number
  /** Omzet en kosten uit de samenwerkingen in het Kantoor, per maand en per jaar. */
  kantoorOmzetPerMonth: number[]; kantoorOmzetFY: number
  kantoorKostPerMonth: number[]; kantoorKostFY: number
  jaarloon: number; socialAnnual: number; socialPerQuarter: number
  socialAsCostFY: number; socialPerMonth: number
  winstFY: number; taxFY: number; netFY: number
  mrr: number; recurringCostNow: number; remainingRecurring: number
}

export function computeCore(
  entries: RevenueEntry[], costs: CostEntry[], settings: FiscalSettings, year: number,
  clientMap: Map<string, string>, invoices: InvoiceRow[] = [],
  recurring: RecurringInvoice[] = [], recurringStatus: Map<string, string> = new Map(),
  /** Kost van de appointment setters per maand, in euro. */
  setterPerMonth: number[] = [],
  /** Omzet en kosten uit het Kantoor per maand, in euro. */
  kantoor: { omzet: number[]; kosten: number[] } = { omzet: [], kosten: [] },
): FinanceCore {
  // Omzet komt uit FACTUREN — losse facturen ÉN terugkerende facturen.
  // Geannuleerde tellen niet mee; bedragen excl. btw (= omzet).
  const invMonth = (mi: number) => {
    const key = `${year}-${String(mi + 1).padStart(2, '0')}`
    let invoiced = 0, open = 0
    const add = (amount: number, rawStatus: string | null | undefined) => {
      const s = normalizeInvoiceStatus(rawStatus)
      if (s === 'geannuleerd') return
      if (s === 'verstuurd') invoiced += amount
      else open += amount
    }
    for (const i of invoices) {
      if ((i.invoice_month ?? '') !== key) continue
      // ALLEEN klantfacturen zijn omzet. Een setter factureert ONS; die staat
      // in dezelfde tabel en zou hier anders als inkomsten meetellen.
      if ((i.kind ?? 'client') !== 'client') continue
      add(Number(i.amount_excl ?? 0), i.status)
    }
    for (const r of recurring) {
      if (!recurringActiveInMonth(r, key)) continue
      add(Number(r.amount_excl ?? 0), recurringStatus.get(`${r.id}|${key}`) ?? 'te_versturen')
    }
    return { invoiced, open, total: invoiced + open }
  }

  const monthly = Array.from({ length: 12 }, (_, mi) => {
    const r = revenueForMonth(entries, year, mi)   // legacy prognose-uitsplitsing
    const inv = invMonth(mi)
    // Samenwerkingen uit het Kantoor tellen mee vanaf de maand waarin ze
    // afgerond zijn. Ze staan NIET in cost_entries/invoices — ze worden
    // afgeleid (lib/kantoor/finance.ts), zodat ze nooit dubbel tellen en een
    // gewijzigde opdracht meteen doorwerkt.
    const kOmzet = Number(kantoor.omzet[mi] ?? 0)
    const kKost = Number(kantoor.kosten[mi] ?? 0)
    return {
      mi,
      omzet: inv.total + kOmzet,
      omzetInvoiced: inv.invoiced + kOmzet,
      omzetOpen: inv.open,
      omzetRec: r.recurring, omzetOne: r.one_time,
      kostenManual: costForMonth(costs, year, mi) + kKost,
    }
  })
  const omzetFY = monthly.reduce((s, m) => s + m.omzet, 0)
  const omzetInvoicedFY = monthly.reduce((s, m) => s + m.omzetInvoiced, 0)
  const omzetOpenFY = monthly.reduce((s, m) => s + m.omzetOpen, 0)
  const omzetRecFY = monthly.reduce((s, m) => s + m.omzetRec, 0)
  const omzetOneFY = monthly.reduce((s, m) => s + m.omzetOne, 0)
  const kostenManualFY = monthly.reduce((s, m) => s + m.kostenManual, 0)
  const kantoorOmzetPerMonth = Array.from({ length: 12 }, (_, mi) => Number(kantoor.omzet[mi] ?? 0))
  const kantoorKostPerMonth = Array.from({ length: 12 }, (_, mi) => Number(kantoor.kosten[mi] ?? 0))
  const kantoorOmzetFY = kantoorOmzetPerMonth.reduce((s, v) => s + v, 0)
  const kantoorKostFY = kantoorKostPerMonth.reduce((s, v) => s + v, 0)

  // Setterkost telt mee als gewone bedrijfskost. Bewust apart bijgehouden en
  // niet in kostenManual gemengd: die staat voor de handmatig ingevoerde
  // kostenposten, en dit wordt automatisch berekend uit gewerkte uren en
  // toegekende commissies.
  //
  // Deze bedragen komen uit dezelfde bron als de setterfacturen (uren en
  // commissie). Ze worden hier ÉÉN keer als kost geteld; de facturen zelf staan
  // bewust buiten de omzet- én kostenberekening, anders telde alles dubbel.
  const setters = Array.from({ length: 12 }, (_, mi) => Number(setterPerMonth[mi] ?? 0))
  const setterCostFY = setters.reduce((s, v) => s + v, 0)

  const ebitdaFY = omzetFY - kostenManualFY - setterCostFY

  const jaarloon = Number(settings.salary_gross_monthly) * Number(settings.salary_months)
  const social = estimateSocialContribution(jaarloon, settings)
  const socialAsCostFY = settings.include_social_as_cost ? social.annual : 0
  const socialPerMonth = socialAsCostFY / 12

  const winstFY = ebitdaFY - socialAsCostFY
  const taxFY = estimateCorporateTax(winstFY, settings)
  const netFY = winstFY - taxFY

  return {
    settings, entries, costs, invoices, clientMap, year, monthly,
    omzetFY, omzetInvoicedFY, omzetOpenFY, omzetRecFY, omzetOneFY, kostenManualFY, ebitdaFY,
    setterPerMonth: setters, setterCostFY,
    kantoorOmzetPerMonth, kantoorOmzetFY, kantoorKostPerMonth, kantoorKostFY,
    jaarloon, socialAnnual: social.annual, socialPerQuarter: social.perQuarter,
    socialAsCostFY, socialPerMonth, winstFY, taxFY, netFY,
    mrr: currentMRR(entries), recurringCostNow: currentRecurringCost(costs),
    remainingRecurring: remainingRecurringRevenue(entries),
  }
}

export async function loadCore(year: number): Promise<FinanceCore> {
  const admin = createAdminSupabaseClient()
  const [{ data: entries }, { data: clients }, { data: costs }, { data: fiscalRow }, { data: invoices }, { data: recurring }, { data: recMonths }] = await Promise.all([
    admin.from('revenue_entries').select('*').order('created_at', { ascending: false }),
    // ALLE klanten (ook gearchiveerde) zodat de klantnaam bij een prognose altijd
    // getoond wordt — anders lijkt een correct gekoppelde prognose "ontkoppeld".
    admin.from('clients').select('id, company_name'),
    admin.from('cost_entries').select('*').order('created_at', { ascending: false }),
    admin.from('fiscal_settings').select('*').eq('year', year).maybeSingle(),
    // Omzetbron: losse facturen van dit boekjaar…
    admin.from('invoices').select('invoice_month, amount_excl, status, client_id, service_slug, kind').like('invoice_month', `${year}-%`),
    // …plus terugkerende facturen (met hun per-maand status).
    admin.from('recurring_invoices').select('*'),
    admin.from('recurring_invoice_months').select('recurring_id, month, status').like('month', `${year}-%`),
  ])
  const settings = mergeFiscalSettings(year, fiscalRow)
  const clientMap = new Map((clients ?? []).map((c) => [c.id, c.company_name]))
  const recStatus = new Map(
    ((recMonths ?? []) as { recurring_id: string; month: string; status: string }[])
      .map((m) => [`${m.recurring_id}|${m.month}`, m.status] as const),
  )
  // Kost van de appointment setters. Faalt dit (bv. tabellen nog niet
  // aangemaakt), dan tonen we de financiën gewoon zonder die post in plaats van
  // het hele dashboard te laten stuklopen.
  let setterPerMonth: number[] = []
  try { setterPerMonth = await setterCostByMonth(year) } catch { setterPerMonth = [] }
  // Zelfde principe: haperen de kantoortabellen, dan tonen we de financiën
  // gewoon zonder die bijdrage.
  let kantoor = { omzet: [] as number[], kosten: [] as number[] }
  try { kantoor = await kantoorPerMaand(year) } catch { /* laat leeg */ }

  return computeCore(
    (entries ?? []) as RevenueEntry[], (costs ?? []) as CostEntry[], settings, year, clientMap,
    (invoices ?? []) as InvoiceRow[], (recurring ?? []) as RecurringInvoice[], recStatus,
    setterPerMonth, kantoor,
  )
}

// Periode → maandindexen (0-based, inclusief)
export function periodRange(period: 'month' | 'quarter' | 'fy', quarter: number, month: number): [number, number] {
  if (period === 'month') return [month - 1, month - 1]
  if (period === 'quarter') return [(quarter - 1) * 3, (quarter - 1) * 3 + 2]
  return [0, 11]
}

export function readPeriodParams(sp: Record<string, string>) {
  const now = new Date()
  const year = Number(sp.fy) || now.getFullYear()
  const period = (['month', 'quarter', 'fy'].includes(sp.period) ? sp.period : 'fy') as 'month' | 'quarter' | 'fy'
  const quarter = Math.min(4, Math.max(1, Number(sp.q) || (Math.floor(now.getMonth() / 3) + 1)))
  const month = Math.min(12, Math.max(1, Number(sp.mo) || (now.getMonth() + 1)))
  return { year, period, quarter, month }
}

export const MONTHS = ['Jan', 'Feb', 'Mrt', 'Apr', 'Mei', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec']
export const PERIOD_LABEL: Record<string, string> = { month: 'Maand', quarter: 'Kwartaal', fy: 'Boekjaar' }
