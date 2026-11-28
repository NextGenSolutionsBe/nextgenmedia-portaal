import 'server-only'
import { randomUUID } from 'node:crypto'
import { MARKETING_BUCKET, MAX_AFBEELDING, isAfbeelding, nieuwPad, type MarketingMap } from '@/lib/marketing-media'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { storage: { from: (b: string) => any } }

/** Ondertekende uploadlink voor één afbeelding in de publieke marketingbucket. */
export async function marketingUploadLink(admin: Admin, map: MarketingMap, b: { mimetype?: unknown; grootte?: unknown }): Promise<{ ok: true; pad: string; token: string; bucket: string } | { ok: false; fout: string; status: number }> {
  const mime = String(b.mimetype ?? '').toLowerCase()
  if (!isAfbeelding(mime)) return { ok: false, fout: 'Kies een JPG, PNG, WebP of GIF. Video\'s plaats je als YouTube-link.', status: 400 }
  const grootte = Number(b.grootte)
  if (!grootte || grootte > MAX_AFBEELDING) return { ok: false, fout: 'De afbeelding is leeg of groter dan 15 MB.', status: 400 }
  const pad = nieuwPad(map, mime, randomUUID())
  const { data, error } = await admin.storage.from(MARKETING_BUCKET).createSignedUploadUrl(pad)
  if (error || !data) return { ok: false, fout: error?.message ?? 'Uploadlink maken mislukt', status: 503 }
  return { ok: true, pad, token: data.token, bucket: MARKETING_BUCKET }
}

/** Een afbeelding weghalen (best effort; bv. een vervangen logo). */
export async function verwijderMarketingBestand(admin: Admin, pad: string | null | undefined): Promise<void> {
  if (!pad) return
  try { await admin.storage.from(MARKETING_BUCKET).remove([pad]) } catch { /* bijzaak */ }
}
