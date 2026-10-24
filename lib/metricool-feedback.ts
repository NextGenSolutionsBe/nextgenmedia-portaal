/**
 * Feedbacklink naar Metricool (per klant, `clients.metricool_feedback_url`).
 * Eén validator voor admin-opslag én portaalweergave: enkel https en een host
 * die op metricool.com eindigt. Alles wat niet klopt telt als "geen link".
 */
export function geldigeMetricoolFeedbackUrl(waarde: string | null | undefined): string | null {
  const s = String(waarde ?? '').trim()
  if (!s) return null
  let u: URL
  try { u = new URL(s) } catch { return null }
  if (u.protocol !== 'https:') return null
  const host = u.hostname.toLowerCase()
  if (host !== 'metricool.com' && !host.endsWith('.metricool.com')) return null
  if (u.username || u.password) return null
  return u.toString()
}

export const METRICOOL_FEEDBACK_FOUT = 'De feedbacklink moet met https:// beginnen en naar metricool.com verwijzen.'
