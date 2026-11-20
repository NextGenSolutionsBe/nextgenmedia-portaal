/**
 * Afbeeldingen voor nieuwsbrieven en partnerlogo's: publieke bucket "marketing"
 * (ze staan in de klantapp én in de nieuwsbriefmail). Video's laden we nooit
 * op; die embedden we via YouTube (lib/youtube.ts). Pure module.
 */

export const MARKETING_BUCKET = 'marketing'
export const AFBEELDING_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }
export const MAX_AFBEELDING = 15 * 1024 * 1024
export type MarketingMap = 'nieuws' | 'partners' | 'events'

export const isAfbeelding = (mime: unknown): boolean => Object.prototype.hasOwnProperty.call(AFBEELDING_TYPES, String(mime ?? '').toLowerCase())

/** Publieke URL van een pad in de bucket (werkt in de browser én in mails). */
export function publiekeUrl(pad: string | null | undefined): string | null {
  if (!pad) return null
  const basis = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')
  return `${basis}/storage/v1/object/public/${MARKETING_BUCKET}/${pad.split('/').map(encodeURIComponent).join('/')}`
}

/** Enkel paden die wij uitgaven, in de juiste map. */
export const geldigPad = (pad: unknown, map: MarketingMap): pad is string =>
  typeof pad === 'string' && new RegExp(`^${map}/\\d{4}-\\d{2}/[0-9a-f-]{36}\\.(jpg|png|webp|gif)$`).test(pad)

export const nieuwPad = (map: MarketingMap, mime: string, id: string, nu = new Date()): string =>
  `${map}/${nu.toISOString().slice(0, 7)}/${id}.${AFBEELDING_TYPES[mime.toLowerCase()] ?? 'jpg'}`
