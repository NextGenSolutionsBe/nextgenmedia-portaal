import 'server-only'

/**
 * Bestandsvalidatie voor uploads.
 *
 * Waarom niet vertrouwen op bestandsnaam of Content-Type: beide komen van de
 * client en zijn vrij te kiezen. Een `.png` die eigenlijk HTML is, geserveerd
 * met `Content-Type: text/html` uit een publieke bucket, levert opgeslagen XSS
 * op ons storage-domein. Daarom bepalen we het type uit de EERSTE BYTES van het
 * bestand (magic bytes) en gebruiken we uitsluitend dát type en die extensie.
 *
 * SVG staat bewust NIET in de lijst: een SVG mag scripts bevatten.
 */

export type UploadKind = 'image' | 'document'

const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
}
const DOC_TYPES: Record<string, string> = { 'application/pdf': 'pdf' }

/** Bepaalt het echte MIME-type uit de eerste bytes. null = onbekend/niet toegestaan. */
export function sniffMime(head: Uint8Array): string | null {
  const b = head
  if (b.length < 4) return null
  // JPEG: FF D8 FF
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png'
  // GIF: "GIF8"
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif'
  // WEBP: "RIFF" .... "WEBP"
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp'
  // PDF: "%PDF"
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'application/pdf'
  return null
}

export type CheckedUpload =
  | { ok: true; mime: string; ext: string; buffer: Buffer }
  | { ok: false; error: string }

/**
 * Controleert grootte én werkelijk bestandstype, en geeft een veilige extensie
 * + het te bewaren MIME-type terug. Gebruik ALTIJD deze waarden bij het opslaan
 * — nooit `file.name` of `file.type`.
 */
export async function checkUpload(
  file: File,
  opts: { maxBytes: number; allow: UploadKind[] },
): Promise<CheckedUpload> {
  if (!file || file.size === 0) return { ok: false, error: 'Geen bestand' }
  if (file.size > opts.maxBytes) {
    return { ok: false, error: `Bestand te groot (max ${Math.round(opts.maxBytes / 1024 / 1024)} MB)` }
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const mime = sniffMime(new Uint8Array(buffer.subarray(0, 12)))

  const allowed: Record<string, string> = {
    ...(opts.allow.includes('image') ? IMAGE_TYPES : {}),
    ...(opts.allow.includes('document') ? DOC_TYPES : {}),
  }
  if (!mime || !allowed[mime]) {
    const labels = Object.values(allowed).join(', ').toUpperCase()
    return { ok: false, error: `Dit bestandstype wordt niet ondersteund. Toegestaan: ${labels}.` }
  }

  return { ok: true, mime, ext: allowed[mime], buffer }
}
