// Klant-lifecycle berekeningen (afgeleid uit het social-mediacontract).
// Batch = startmaand. Strategie-review elke 3 maanden vanaf de start.

export const MONTHS_NL = [
  'Januari', 'Februari', 'Maart', 'April', 'Mei', 'Juni',
  'Juli', 'Augustus', 'September', 'Oktober', 'November', 'December',
]

const d = (iso: string) => new Date(iso.slice(0, 10) + 'T00:00:00')

export function batchName(startISO: string | null): string | null {
  if (!startISO) return null
  return MONTHS_NL[d(startISO).getMonth()]
}

export function resolveEndDate(startISO: string | null, months: number | null, endISO: string | null): string | null {
  if (endISO) return endISO.slice(0, 10)
  if (!startISO || !months) return null
  const s = d(startISO); s.setMonth(s.getMonth() + months)
  return s.toISOString().slice(0, 10)
}

/** Maanden tussen de start en (year, month). */
export function monthsSinceStart(startISO: string | null, year: number, month: number): number | null {
  if (!startISO) return null
  const s = d(startISO)
  return (year - s.getFullYear()) * 12 + (month - s.getMonth())
}

/** Is (year, month) een strategie-reviewmaand? (elke 3 maanden ná de start) */
export function isReviewMonth(startISO: string | null, year: number, month: number): boolean {
  const n = monthsSinceStart(startISO, year, month)
  return n != null && n > 0 && n % 3 === 0
}

/** Eerstvolgende strategie-reviewdatum vanaf `from` (eerste van die maand). */
export function nextReviewDate(startISO: string | null, from = new Date()): string | null {
  if (!startISO) return null
  const cur = new Date(from.getFullYear(), from.getMonth(), 1)
  for (let i = 0; i < 48; i++) {
    if (isReviewMonth(startISO, cur.getFullYear(), cur.getMonth())) return cur.toISOString().slice(0, 10)
    cur.setMonth(cur.getMonth() + 1)
  }
  return null
}

export function daysUntil(iso: string | null): number | null {
  if (!iso) return null
  return Math.round((d(iso).getTime() - Date.now()) / 86400000)
}

export type ClientLifecycle = {
  clientId: string
  companyName: string
  startDate: string | null
  contractMonths: number | null
  endDate: string | null
  batch: string | null
  batchMonth: number | null
  daysUntilEnd: number | null
  nextReview: string | null
  reviewThisMonth: boolean
  hasPlanning: boolean
}

export function buildLifecycle(input: {
  clientId: string; companyName: string; startDate: string | null; contractMonths: number | null; endDate: string | null; hasPlanning: boolean
}, now = new Date()): ClientLifecycle {
  const endDate = resolveEndDate(input.startDate, input.contractMonths, input.endDate)
  return {
    clientId: input.clientId, companyName: input.companyName,
    startDate: input.startDate, contractMonths: input.contractMonths, endDate,
    batch: batchName(input.startDate),
    batchMonth: input.startDate ? d(input.startDate).getMonth() : null,
    daysUntilEnd: daysUntil(endDate),
    nextReview: nextReviewDate(input.startDate, now),
    reviewThisMonth: isReviewMonth(input.startDate, now.getFullYear(), now.getMonth()),
    hasPlanning: input.hasPlanning,
  }
}

// Contract-waarschuwingsdrempels (dagen vooraf)
export const WARN_THRESHOLDS = [60, 30, 14, 7]
export function warnBucket(daysLeft: number | null): number | null {
  if (daysLeft == null || daysLeft < 0) return daysLeft != null && daysLeft < 0 ? 0 : null
  for (const t of WARN_THRESHOLDS) if (daysLeft <= t) return t
  return null
}
