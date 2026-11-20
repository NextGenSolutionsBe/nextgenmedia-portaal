import { geldigPad } from '@/lib/marketing-media'

/**
 * Onze partners: de bedrijven achter en rond NextGenMedia, met een korte uitleg
 * en links naar hun website en socials. Beheerd in de admin, zichtbaar in de
 * klantapp. Pure module.
 */

export type Partner = {
  id: string; naam: string; korte_uitleg: string | null; logo_pad: string | null
  website: string | null; instagram: string | null; facebook: string | null; linkedin: string | null; tiktok: string | null; youtube: string | null
  volgorde: number; zichtbaar: boolean
}
export type LinkSleutel = 'website' | 'instagram' | 'facebook' | 'linkedin' | 'tiktok' | 'youtube'

export const LINKS: { key: LinkSleutel; label: string; basis: string | null; host: string | null; voorbeeld: string }[] = [
  { key: 'website', label: 'Website', basis: null, host: null, voorbeeld: 'https://bedrijf.be' },
  { key: 'instagram', label: 'Instagram', basis: 'https://www.instagram.com/', host: 'instagram.com', voorbeeld: '@bedrijf of https://instagram.com/bedrijf' },
  { key: 'facebook', label: 'Facebook', basis: 'https://www.facebook.com/', host: 'facebook.com', voorbeeld: 'https://facebook.com/bedrijf' },
  { key: 'linkedin', label: 'LinkedIn', basis: 'https://www.linkedin.com/company/', host: 'linkedin.com', voorbeeld: 'https://linkedin.com/company/bedrijf' },
  { key: 'tiktok', label: 'TikTok', basis: 'https://www.tiktok.com/@', host: 'tiktok.com', voorbeeld: '@bedrijf' },
  { key: 'youtube', label: 'YouTube', basis: 'https://www.youtube.com/@', host: 'youtube.com', voorbeeld: '@bedrijf' },
]

/**
 * Een link netjes maken: "@bedrijf" of "bedrijf" → profiel-URL; "instagram.com/x"
 * → https://instagram.com/x. Enkel https, en socials enkel op hun eigen domein.
 * Leeg = null; ongeldig = fout.
 */
export function normaliseerLink(key: LinkSleutel, invoer: unknown): { ok: true; waarde: string | null } | { ok: false; fout: string } {
  const def = LINKS.find((l) => l.key === key)!
  let s = String(invoer ?? '').trim()
  if (!s) return { ok: true, waarde: null }
  if (def.basis && /^@?[A-Za-z0-9._-]{2,60}$/.test(s) && !s.includes('.')) s = def.basis + s.replace(/^@/, '')
  else if (def.basis && /^@[A-Za-z0-9._-]{2,60}$/.test(s)) s = def.basis + s.slice(1)
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`
  let u: URL
  try { u = new URL(s) } catch { return { ok: false, fout: `${def.label}: dit is geen geldige link.` } }
  if (u.protocol === 'http:') u.protocol = 'https:'
  const host = u.hostname.replace(/^www\./, '').toLowerCase()
  if (!host.includes('.')) return { ok: false, fout: `${def.label}: dit is geen geldige link.` }
  if (def.host && host !== def.host && !host.endsWith(`.${def.host}`)) return { ok: false, fout: `${def.label}: de link moet naar ${def.host} gaan.` }
  return { ok: true, waarde: u.toString() }
}

export function valideerPartner(b: Record<string, unknown>): { ok: true; waarde: Omit<Partner, 'id' | 'volgorde'> } | { ok: false; fout: string } {
  const naam = String(b.naam ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  if (naam.length < 2) return { ok: false, fout: 'Vul de naam van het bedrijf in.' }
  const links: Partial<Record<LinkSleutel, string | null>> = {}
  for (const l of LINKS) {
    const r = normaliseerLink(l.key, b[l.key])
    if (!r.ok) return r
    links[l.key] = r.waarde
  }
  const logo = b.logo_pad == null || b.logo_pad === '' ? null : geldigPad(b.logo_pad, 'partners') ? b.logo_pad : undefined
  if (logo === undefined) return { ok: false, fout: 'Laad het logo opnieuw op.' }
  return {
    ok: true,
    waarde: {
      naam, korte_uitleg: String(b.korte_uitleg ?? '').trim().slice(0, 600) || null, logo_pad: logo,
      website: links.website ?? null, instagram: links.instagram ?? null, facebook: links.facebook ?? null,
      linkedin: links.linkedin ?? null, tiktok: links.tiktok ?? null, youtube: links.youtube ?? null,
      zichtbaar: b.zichtbaar !== false,
    },
  }
}
