// Pure berekening van de health score + slimme waarschuwingen per blogaccount.
// Geen DB-toegang — krijgt alle benodigde cijfers als input (snel + testbaar).

export type HealthInput = {
  hasBriefing: boolean
  hasKnowledge: boolean
  websiteAnalyzed: boolean
  framerValid: boolean
  published: number
  review: number
  failed: number
  syncProblems: number
  total: number
  maxLiveBlogs: number | null
  websiteChanged: boolean
  cronOk: boolean
  active: boolean
}

export type HealthResult = {
  score: number
  status: 'groen' | 'oranje' | 'rood'
  warnings: string[]
}

export function computeHealth(i: HealthInput): HealthResult {
  let score = 0
  if (i.hasBriefing) score += 20
  if (i.websiteAnalyzed) score += 20
  if (i.framerValid) score += 25
  if (i.published > 0 && i.failed === 0) score += 20
  else if (i.published > 0) score += 10
  if (i.total >= 3) score += 15
  else if (i.total > 0) score += 7
  // Aftrek voor problemen
  if (i.failed > 0) score -= 10
  if (i.syncProblems > 0) score -= 10
  score = Math.max(0, Math.min(100, score))

  const warnings: string[] = []
  if (!i.hasBriefing) warnings.push('Geen briefing aanwezig')
  if (!i.websiteAnalyzed) warnings.push('Website nog niet geanalyseerd')
  if (!i.framerValid) warnings.push('Framer niet (volledig) verbonden')
  if (i.maxLiveBlogs && i.published >= i.maxLiveBlogs) warnings.push('Maximum aantal live blogs bereikt')
  if (i.failed > 0) warnings.push(`${i.failed} blog(generatie/publicatie) mislukt`)
  if (i.syncProblems > 0) warnings.push(`${i.syncProblems} blog(s) met synchronisatieprobleem`)
  if (i.websiteChanged) warnings.push('Website gewijzigd — heranalyse aanbevolen')
  if (!i.cronOk) warnings.push('Automatische generatie (cron) lijkt niet recent gelopen')

  const status: HealthResult['status'] = score >= 80 && warnings.length === 0 ? 'groen' : score >= 50 ? 'oranje' : 'rood'
  return { score, status, warnings }
}
