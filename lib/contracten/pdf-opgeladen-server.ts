import 'server-only'
import { MAX_PDF_MB } from '@/lib/upload'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any

/** Een pad uit /api/admin/contracts/upload-link (enkel `opladen/<uuid>.pdf`). */
export const isOpgeladenPad = (v: unknown): v is string => typeof v === 'string' && /^opladen\/[0-9a-f-]{36}\.pdf$/i.test(v)

/** De rechtstreeks opgeladen pdf ophalen en nakijken (tot 10 MB, echt een pdf). */
export async function haalOpgeladenPdf(admin: Admin, pad: string): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from('contracts').download(pad)
  if (error || !data) throw new Error('De PDF is niet (volledig) opgeladen. Probeer opnieuw.')
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (!bytes.length) throw new Error('De PDF is leeg.')
  if (bytes.length > MAX_PDF_MB * 1024 * 1024) throw new Error(`PDF te groot — max ${MAX_PDF_MB} MB.`)
  if (Buffer.from(bytes.slice(0, 1024)).toString('latin1').indexOf('%PDF') === -1) throw new Error('Dit is geen PDF.')
  return bytes
}

/** Het tijdelijke bestand weg, zodra de pdf op zijn vaste plaats staat. */
export async function ruimOpgeladenOp(admin: Admin, pad: string): Promise<void> {
  await admin.storage.from('contracts').remove([pad]).catch(() => null)
}
