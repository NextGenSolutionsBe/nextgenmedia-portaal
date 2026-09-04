/**
 * De deel-link van publicprocurement.be omzetten naar de shortLink-code.
 *
 * Pure module — ook bruikbaar in de browser, zodat het invoerveld meteen kan
 * tonen wat er bewaard wordt.
 *
 * De gebruiker plakt doorgaans de volledige URL uit zijn browser; soms enkel
 * de code. Allebei moet werken, want niemand gaat die code uit een adresbalk
 * zitten knippen.
 */

/** Haalt 'v2-abc123' uit een volledige URL, of geeft een ingetikte code terug. */
export function parseShortLink(input: string): string {
  const raw = (input ?? '').trim()
  if (!raw) return ''

  const match = /shortLink=([^&\s#]+)/i.exec(raw)
  if (match) return decodeURIComponent(match[1]).trim()

  // Geen parameter gevonden maar wel een URL: dan is dit niet de juiste link.
  if (/^https?:\/\//i.test(raw)) return ''

  return raw
}

/** Ziet dit eruit als een bruikbare code? Voorkomt onzin in de database. */
export function isValidShortLink(code: string): boolean {
  return /^[A-Za-z0-9._~-]{4,120}$/.test(code)
}

/** De deel-link terug opbouwen, om hem in de UI te kunnen tonen of openen. */
export function shortLinkUrl(code: string): string {
  return `https://www.publicprocurement.be/bda?shortLink=${encodeURIComponent(code)}`
}
