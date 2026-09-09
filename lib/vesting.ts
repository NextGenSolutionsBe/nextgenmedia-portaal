// Vestigingsprincipe (informatief). Marco verwerft aandelen op basis van
// gerealiseerde "vestigingsomzet" via drie schijven. Wijzigt geen echte aandelen.

export type VestingConfig = {
  start_date: string | null
  schijf2_per: number   // € netto omzet per extra % in schijf 2 (5% → 10%)
  schijf3_y1: number    // € per extra % in schijf 3, jaar 1 (10% → 30%)
  schijf3_y2: number    // jaar 2
  schijf3_y3: number    // jaar 3
  inbound_pct: number   // toerekening inbound %
  website_pct: number   // toerekening website %
}

export const DEFAULT_VESTING_CONFIG: VestingConfig = {
  start_date: null, schijf2_per: 5000, schijf3_y1: 10000, schijf3_y2: 12000, schijf3_y3: 15000,
  inbound_pct: 30, website_pct: 100,
}

// Vaste contractparameters
export const START_PCT = 5        // schijf 1: reeds verworven
export const SCHIJF2_END = 10     // einde schijf 2
export const MAX_PCT = 30         // maximum aandeel Marco
// Aandeelhouders (informatieve weergave)
export const BRAM_NOW = 65, BRAM_MIN = 40, CHIARA_FIXED = 30

export function mergeVestingConfig(row: Partial<VestingConfig> | null | undefined): VestingConfig {
  const d = { ...DEFAULT_VESTING_CONFIG }
  if (!row) return d
  for (const k of Object.keys(d) as (keyof VestingConfig)[]) {
    const v = row[k]
    if (v !== undefined && v !== null) (d as Record<string, unknown>)[k] = v
  }
  return d
}

/** Vestigingsjaar (1..3) o.b.v. de startdatum en vandaag. */
export function vestingYear(startDate: string | null, now = new Date()): number {
  if (!startDate) return 1
  const s = new Date(startDate.slice(0, 10) + 'T00:00:00')
  let years = now.getFullYear() - s.getFullYear()
  const anniv = new Date(s); anniv.setFullYear(s.getFullYear() + years)
  if (now < anniv) years -= 1
  return Math.min(3, Math.max(1, years + 1))
}

export function schijf3Rate(cfg: VestingConfig, year: number): number {
  return year === 1 ? cfg.schijf3_y1 : year === 2 ? cfg.schijf3_y2 : cfg.schijf3_y3
}

/** Cumulatieve vestigingsomzet nodig om een geheel percentage p te bereiken. */
export function thresholdForPct(p: number, cfg: VestingConfig, s3rate: number): number {
  if (p <= START_PCT) return 0
  if (p <= SCHIJF2_END) return (p - START_PCT) * cfg.schijf2_per
  return (SCHIJF2_END - START_PCT) * cfg.schijf2_per + (p - SCHIJF2_END) * s3rate
}

/** Continu percentage (5..30) op basis van totale vestigingsomzet. */
export function pctFromRevenue(total: number, cfg: VestingConfig, s3rate: number): number {
  if (total <= 0) return START_PCT
  const schijf2Cap = (SCHIJF2_END - START_PCT) * cfg.schijf2_per
  if (total <= schijf2Cap) return START_PCT + total / cfg.schijf2_per
  const pct = SCHIJF2_END + (total - schijf2Cap) / s3rate
  return Math.min(MAX_PCT, pct)
}

/** Volledige progressie-status. */
export function vestingStatus(total: number, cfg: VestingConfig, now = new Date()) {
  const year = vestingYear(cfg.start_date, now)
  const s3rate = schijf3Rate(cfg, year)
  const pct = pctFromRevenue(total, cfg, s3rate)
  const currentInt = Math.min(MAX_PCT, Math.floor(pct + 1e-9))
  const nextInt = Math.min(MAX_PCT, currentInt + 1)
  const atMax = currentInt >= MAX_PCT
  const thrNext = thresholdForPct(nextInt, cfg, s3rate)
  const thrCur = thresholdForPct(currentInt, cfg, s3rate)
  const neededForNext = atMax ? 0 : Math.max(0, thrNext - total)
  const costStep = atMax ? 0 : thrNext - thrCur
  return { year, s3rate, pct, currentInt, nextInt, atMax, neededForNext, costStep }
}

// Toerekening (vast volgens overeenkomst):
//   Outbound = outreach (50%) + closing (50%)  → 0 / 50 / 100%
//   Inbound  = closing (25%)                    → 0 / 25%
export const OUTREACH_PCT = 50
export const CLOSING_OUTBOUND_PCT = 50
export const CLOSING_INBOUND_PCT = 25

export function attributionFor(type: string, opts: { outreach?: boolean; closing?: boolean }): number {
  if (type === 'outbound') return (opts.outreach ? OUTREACH_PCT : 0) + (opts.closing ? CLOSING_OUTBOUND_PCT : 0)
  // inbound
  return opts.closing ? CLOSING_INBOUND_PCT : 0
}
