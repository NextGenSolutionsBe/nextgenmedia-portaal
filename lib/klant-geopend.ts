/**
 * Wanneer telt het openen van een publieke link (contract of offerte) als
 * "door de klant geopend"? Niet als iemand van het team kijkt (ingelogd), en
 * niet als een linkvoorbeeld of virusscanner de pagina ophaalt (mailprogramma's,
 * WhatsApp, Slack, Outlook Safe Links …). Pure module.
 */

const AUTOMATISCH = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp\/|slackbot|slack-imgproxy|discordbot|telegrambot|skypeuripreview|linkedinbot|googleimageproxy|bingpreview|microsoft office|ms-office|outlook-safelinks|safelinks|proofpoint|mimecast|barracuda|headlesschrome|python-requests|curl\/|wget/i

export function isAutomatischeBezoeker(userAgent: string | null | undefined): boolean {
  const ua = String(userAgent ?? '')
  return !ua.trim() || AUTOMATISCH.test(ua)
}

/** Kort toestel uit de user-agent: "iPhone", "Android", "iPad", "Mac", "Windows", anders "Browser". */
export function toestelVan(userAgent: string | null | undefined): string {
  const ua = String(userAgent ?? '')
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? 'Android-gsm' : 'Android-tablet'
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac'
  if (/Windows/i.test(ua)) return 'Windows'
  if (/Linux/i.test(ua)) return 'Linux'
  return 'Browser'
}

/** "Door klant geopend op 6 nov" (met jaar als het niet dit jaar is). */
export function geopendTekst(iso: string | null | undefined, nu: Date = new Date()): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const zelfdeJaar = d.toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }).slice(0, 4) === nu.toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' }).slice(0, 4)
  return `Door klant geopend op ${d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', ...(zelfdeJaar ? {} : { year: 'numeric' }), timeZone: 'Europe/Brussels' })}`
}
