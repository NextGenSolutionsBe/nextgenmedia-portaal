// Instelbare fiscale parameters per boekjaar + pure (indicatieve) berekeningen.
// GEEN hardcoded percentages in de business logic: alle waarden komen uit
// FiscalSettings, die admin per boekjaar kan aanpassen. De defaults hieronder
// zijn publieke richtwaarden (BE) en bewust wijzigbaar.

export type FiscalSettings = {
  year: number
  // Vennootschapsbelasting
  corporate_tax_pct: number      // standaardtarief %
  reduced_tax_pct: number        // verlaagd tarief % (eerste schijf)
  reduced_tax_limit: number      // grens verlaagd tarief (€)
  // Sociale bijdragen (zelfstandige / zaakvoerder)
  social_pct_band1: number       // % schijf 1
  social_pct_band2: number       // % schijf 2
  income_band1_limit: number     // inkomensgrens schijf 1 (€)
  income_band2_limit: number     // inkomensgrens schijf 2 (€)
  mgmt_fee_pct: number           // beheerskost sociaal verzekeringsfonds %
  min_quarter: number            // minimum kwartaalbijdrage (€)
  max_quarter: number            // maximum kwartaalbijdrage (€)
  extra_pct: number              // aanvullend % (optioneel)
  extra_fixed: number            // aanvullend vast bedrag per jaar (€)
  // Loon / bezoldiging
  salary_gross_monthly: number   // bruto bezoldiging per maand (€)
  salary_months: number          // aantal maanden
  statuut: string                // bv. 'zaakvoerder'
  include_social_as_cost: boolean // sociale bijdragen meenemen als kost in rapportage
  // BTW & cash (dashboard 3.0)
  vat_pct: number                // BTW-percentage %
  cash_reserve_pct: number       // % van omzet apart te houden (BTW/belasting-reserve)
  cash_on_account: number        // huidige cash op rekening (handmatig) (€)
  partner_draws: number          // opnames vennoten dit boekjaar (€)
}

/** Publieke richtwaarden — bewust aanpasbaar per boekjaar. */
export function defaultFiscalSettings(year: number): FiscalSettings {
  return {
    year,
    corporate_tax_pct: 25,
    reduced_tax_pct: 20,
    reduced_tax_limit: 100000,
    social_pct_band1: 20.5,
    social_pct_band2: 14.16,
    income_band1_limit: 75000,
    income_band2_limit: 115000,
    mgmt_fee_pct: 3.05,
    min_quarter: 870,
    max_quarter: 5000,
    extra_pct: 0,
    extra_fixed: 0,
    salary_gross_monthly: 0,
    salary_months: 12,
    statuut: 'zaakvoerder',
    include_social_as_cost: false,
    vat_pct: 21,
    cash_reserve_pct: 25,
    cash_on_account: 0,
    partner_draws: 0,
  }
}

/** Vul ontbrekende velden van een (deels) opgeslagen rij aan met defaults. */
export function mergeFiscalSettings(year: number, row: Partial<FiscalSettings> | null | undefined): FiscalSettings {
  const d = defaultFiscalSettings(year)
  if (!row) return d
  const out = { ...d }
  for (const k of Object.keys(d) as (keyof FiscalSettings)[]) {
    const v = row[k]
    if (v !== undefined && v !== null) (out as Record<string, unknown>)[k] = v
  }
  out.year = year
  return out
}

/** Indicatieve vennootschapsbelasting: verlaagd tarief tot de grens, daarboven standaard. */
export function estimateCorporateTax(profitBeforeTax: number, s: FiscalSettings): number {
  if (profitBeforeTax <= 0) return 0
  const reducedPart = Math.min(profitBeforeTax, s.reduced_tax_limit)
  const standardPart = Math.max(0, profitBeforeTax - s.reduced_tax_limit)
  return reducedPart * (s.reduced_tax_pct / 100) + standardPart * (s.corporate_tax_pct / 100)
}

/** Indicatieve sociale bijdragen (zelfstandige) op een jaarinkomen. */
export function estimateSocialContribution(annualIncome: number, s: FiscalSettings): { annual: number; perQuarter: number } {
  if (annualIncome <= 0) return { annual: 0, perQuarter: 0 }
  const p1 = Math.min(annualIncome, s.income_band1_limit) * (s.social_pct_band1 / 100)
  const p2 = Math.max(0, Math.min(annualIncome, s.income_band2_limit) - s.income_band1_limit) * (s.social_pct_band2 / 100)
  let base = p1 + p2
  base += base * (s.mgmt_fee_pct / 100)            // beheerskost fonds
  base += base * (s.extra_pct / 100) + s.extra_fixed // aanvullend
  let perQuarter = base / 4
  perQuarter = Math.min(Math.max(perQuarter, s.min_quarter), s.max_quarter)
  return { annual: perQuarter * 4, perQuarter }
}

// ── Gedeelde data-types + maand-berekeningen (hergebruikt over alle tabs) ─────

export type RevenueEntry = {
  id: string; client_id: string; title: string | null; service_slug: string | null
  type: 'recurring' | 'one_time'; billing_frequency: string | null
  amount_per_month: number | null; start_month: string | null; end_month: string | null
  amount: number | null; transaction_month: string | null; notes: string | null; created_at: string
}
export type CostEntry = {
  id: string; name: string | null; category: string | null; type: 'one_time' | 'recurring'
  cost_date: string | null; start_date: string | null; end_date: string | null
  billing_frequency: string | null; amount_excl: number; vat_pct: number
}

const FREQ_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, 'semi-annual': 6, annual: 12 }
export const toMonthly = (amount: number, freq: string | null) => amount / (FREQ_MONTHS[freq ?? 'monthly'] ?? 1)
export const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

export function revActive(e: RevenueEntry, y: number, m: number): boolean {
  if (!e.start_month) return false
  const cur = `${y}-${String(m + 1).padStart(2, '0')}`
  if (cur < monthKey(new Date(e.start_month))) return false
  if (!e.end_month) return true
  return cur <= monthKey(new Date(e.end_month))
}
/** Omzet (excl. btw) voor één maand, opgesplitst. */
export function revenueForMonth(entries: RevenueEntry[], y: number, m: number): { recurring: number; one_time: number } {
  let recurring = 0, one_time = 0
  for (const e of entries) {
    if (e.type === 'recurring' && e.amount_per_month && revActive(e, y, m)) recurring += toMonthly(e.amount_per_month, e.billing_frequency)
    if (e.type === 'one_time' && e.amount && e.transaction_month) { const tm = new Date(e.transaction_month); if (tm.getFullYear() === y && tm.getMonth() === m) one_time += e.amount }
  }
  return { recurring, one_time }
}
export function costActive(c: CostEntry, y: number, m: number): boolean {
  if (!c.start_date) return false
  const cur = `${y}-${String(m + 1).padStart(2, '0')}`
  if (cur < monthKey(new Date(c.start_date))) return false
  if (!c.end_date) return true
  return cur <= monthKey(new Date(c.end_date))
}
/** Kosten (excl. btw) voor één maand. */
export function costForMonth(costs: CostEntry[], y: number, m: number): number {
  let t = 0
  for (const c of costs) {
    if (c.type === 'recurring' && costActive(c, y, m)) t += toMonthly(Number(c.amount_excl), c.billing_frequency)
    if (c.type === 'one_time' && c.cost_date) { const d = new Date(c.cost_date); if (d.getFullYear() === y && d.getMonth() === m) t += Number(c.amount_excl) }
  }
  return t
}
/** Huidige recurring omzet per maand (MRR) op datum. */
export function currentMRR(entries: RevenueEntry[], at = new Date()): number {
  return entries.filter(e => e.type === 'recurring' && revActive(e, at.getFullYear(), at.getMonth()))
    .reduce((s, e) => s + toMonthly(e.amount_per_month ?? 0, e.billing_frequency), 0)
}
export function currentRecurringCost(costs: CostEntry[], at = new Date()): number {
  return costs.filter(c => c.type === 'recurring' && costActive(c, at.getFullYear(), at.getMonth()))
    .reduce((s, c) => s + toMonthly(Number(c.amount_excl), c.billing_frequency), 0)
}
/** Resterende toekomstige recurring omzet (vanaf nu, niet-aflopende geplafonneerd op `cap` maanden). */
export function remainingRecurringRevenue(entries: RevenueEntry[], at = new Date(), cap = 24): number {
  return entries.filter(e => e.type === 'recurring' && e.start_month).reduce((s, e) => {
    if (!e.amount_per_month) return s
    const m = toMonthly(e.amount_per_month, e.billing_frequency)
    const start = new Date(e.start_month!); const end = e.end_month ? new Date(e.end_month) : null
    let cursor = new Date(at.getFullYear(), at.getMonth(), 1); if (cursor < start) cursor = new Date(start)
    let count = 0, safety = 0
    while (safety++ < 600) {
      const k = monthKey(cursor)
      if (k < monthKey(at)) { cursor.setMonth(cursor.getMonth() + 1); continue }
      if (end && k > monthKey(end)) break
      if (!end && count >= cap) break
      count++; cursor.setMonth(cursor.getMonth() + 1)
    }
    return s + m * count
  }, 0)
}
