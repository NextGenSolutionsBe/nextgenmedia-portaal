import 'server-only'
import { createHash, randomUUID } from 'crypto'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import type { Bewijs } from '@/lib/vesting-akkoord'

type Admin = ReturnType<typeof createAdminSupabaseClient>

/**
 * Bewijsstukken bij een inkomst of kost (het contract, de factuur …) in de
 * privébucket `vesting`. De browser laadt rechtstreeks op met een ondertekende
 * link; de server leest het bestand daarna één keer en bewaart de SHA-256, die
 * mee in de getekende cijfers zit. Zo gaat een handtekening ook over exact dat
 * bestand.
 */
export const VESTING_BUCKET = 'vesting'
const MAX = 25 * 1024 * 1024
const TYPES: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' }

export class BewijsFout extends Error {}

const veiligeNaam = (naam: string) => naam.normalize('NFKD').replace(/[^\w.\-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 120) || 'document'

export async function bewijsUploadLink(admin: Admin, naam: string, grootte: number): Promise<{ pad: string; token: string; bucket: string; contentType: string }> {
  const ext = (naam.split('.').pop() ?? '').toLowerCase()
  const contentType = TYPES[ext]
  if (!contentType) throw new BewijsFout('Enkel pdf, jpg of png.')
  if (!Number.isFinite(grootte) || grootte <= 0) throw new BewijsFout('Leeg bestand.')
  if (grootte > MAX) throw new BewijsFout('Het bestand is groter dan 25 MB.')
  const pad = `bewijs/${randomUUID()}/${veiligeNaam(naam)}`
  const { data, error } = await admin.storage.from(VESTING_BUCKET).createSignedUploadUrl(pad)
  if (error || !data?.token) throw new Error(error?.message ?? 'Uploadlink maken mislukt')
  return { pad, token: data.token as string, bucket: VESTING_BUCKET, contentType }
}

/** Het opgeladen bestand lezen en de vingerafdruk berekenen. */
export async function verwerkBewijs(admin: Admin, invoer: { pad: string; naam: string }): Promise<Bewijs> {
  const { data, error } = await admin.storage.from(VESTING_BUCKET).download(invoer.pad)
  if (error || !data) throw new BewijsFout('Het document is niet (volledig) opgeladen. Probeer opnieuw.')
  const bytes = Buffer.from(await data.arrayBuffer())
  if (!bytes.length) throw new BewijsFout('Het document is leeg.')
  if (bytes.length > MAX) throw new BewijsFout('Het bestand is groter dan 25 MB.')
  return { pad: invoer.pad, naam: invoer.naam, sha256: createHash('sha256').update(bytes).digest('hex'), grootte: bytes.length }
}

export const bewijsKolommen = (b: Bewijs) => ({ bewijs_pad: b.pad, bewijs_naam: b.naam, bewijs_sha256: b.sha256, bewijs_grootte: b.grootte })

/** Een kortlevende link om het bestand te bekijken. */
export async function bewijsLink(admin: Admin, pad: string, seconden = 120): Promise<string | null> {
  const { data } = await admin.storage.from(VESTING_BUCKET).createSignedUrl(pad, seconden)
  return data?.signedUrl ?? null
}
