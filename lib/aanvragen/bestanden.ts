// Aanvragen — regels voor bestanden en referenties. Gedeeld door portaal,
// admin en tests, zodat iedereen dezelfde grenzen hanteert.

export const BUCKET = 'aanvragen'

/** Witte lijst: documenten, beelden en korte video’s. */
export const TOEGESTAAN: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
}

/** 100 MB per bestand, hoogstens 10 bestanden per aanvraag. */
export const MAX_BYTES = 100 * 1024 * 1024
export const MAX_BESTANDEN = 10

export const mimeToegestaan = (mime: unknown): boolean => Object.prototype.hasOwnProperty.call(TOEGESTAAN, String(mime ?? '').toLowerCase())

/** Pad in de bucket. Het client_id vooraan: een bestand kan nooit bij een andere klant belanden. */
export const bouwPad = (clientId: string, mime: string, id: string): string => `${clientId}/${id}.${TOEGESTAAN[mime.toLowerCase()] ?? 'bin'}`

/** Hoort dit pad bij deze klant (en is het een pad dat wij uitgaven)? */
export const padVanKlant = (pad: unknown, clientId: string): pad is string =>
  typeof pad === 'string' && new RegExp(`^${clientId}/[0-9a-f-]{36}\\.[a-z0-9]{2,5}$`).test(pad)

/** Offertes laadt het team op, onder een eigen voorvoegsel. */
export const offertePad = (aanvraagId: string, id: string): string => `offertes/${aanvraagId}/${id}.pdf`
