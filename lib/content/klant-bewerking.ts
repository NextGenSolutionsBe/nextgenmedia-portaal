// Wat een klant zelf mag aanpassen aan een contentitem — pure module (getest in tests/klant-content-bewerking.test.ts).
//
// Klanten met de dienst social media passen hun contentplanner zelf aan:
// titel, caption, script, media-notities, datum, type en kanalen — net als wij.
// NIET: status (goedkeuren/feedback loopt via de bestaande review), klant,
// ClickUp-velden en interne notities (die staan in een aparte tabel en komen
// nooit in het portaal).

import { KANAAL_SLUGS, normaliseerKanalen } from '@/lib/social-platforms'

export const KLANT_VELDEN = ['title', 'caption', 'script', 'media_notes', 'planned_date', 'planned_time', 'content_type', 'platforms'] as const
export const CONTENT_TYPES = ['post', 'reel', 'story', 'carousel'] as const
const ISO = /^\d{4}-\d{2}-\d{2}$/

export type KlantPatch = Partial<{ title: string; caption: string | null; script: string | null; media_notes: string | null; planned_date: string; planned_time: string | null; content_type: string; platforms: string[]; platform: string }>

/** Saneert de invoer van een klant tot toegestane velden. Gooit een leesbare fout bij ongeldige waarden. */
export function klantPatch(invoer: Record<string, unknown>): KlantPatch {
  const p: KlantPatch = {}
  if ('title' in invoer) {
    const t = String(invoer.title ?? '').trim()
    if (!t) throw new Error('De titel mag niet leeg zijn.')
    p.title = t.slice(0, 300)
  }
  for (const k of ['caption', 'script', 'media_notes'] as const) {
    if (k in invoer) { const v = String(invoer[k] ?? ''); p[k] = v.trim() ? v.slice(0, 20000) : null }
  }
  if ('planned_date' in invoer) {
    const d = String(invoer.planned_date ?? '')
    if (!ISO.test(d) || Number.isNaN(Date.parse(d))) throw new Error('Kies een geldige datum.')
    p.planned_date = d
  }
  if ('planned_time' in invoer) {
    const t = String(invoer.planned_time ?? '').trim()
    if (t && !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(t)) throw new Error('Geef een geldig tijdstip (uu:mm).')
    p.planned_time = t ? t.slice(0, 5) : null
  }
  if ('content_type' in invoer) {
    const t = String(invoer.content_type ?? '')
    if (!(CONTENT_TYPES as readonly string[]).includes(t)) throw new Error('Onbekend type.')
    p.content_type = t
  }
  if ('platforms' in invoer || 'platform' in invoer) {
    const ruw = Array.isArray(invoer.platforms) && invoer.platforms.length ? invoer.platforms : invoer.platform
    const k = normaliseerKanalen(ruw as string[] | string).filter((x) => (KANAAL_SLUGS as readonly string[]).includes(x))
    if (!k.length) throw new Error('Kies minstens één kanaal.')
    p.platforms = k; p.platform = k[0]
  }
  return p
}

/** Welke velden echt veranderen (voor de audit en de melding aan ons). */
export function gewijzigdeVelden(oud: Record<string, unknown>, patch: KlantPatch): string[] {
  const norm = (k: string, v: unknown) => (k === 'planned_time' && typeof v === 'string' ? v.slice(0, 5) : v ?? null)
  return Object.entries(patch).filter(([k, v]) => k !== 'platform' && JSON.stringify(norm(k, oud[k])) !== JSON.stringify(norm(k, v))).map(([k]) => k)
}

/** Nieuw item dat de klant zelf inplant: titel, datum en minstens één kanaal zijn verplicht. */
export function klantNieuw(invoer: Record<string, unknown>): KlantPatch & { title: string; planned_date: string; content_type: string; platforms: string[]; platform: string } {
  if (!String(invoer.title ?? '').trim()) throw new Error('Geef het item een titel.')
  if (!invoer.planned_date) throw new Error('Kies een datum.')
  const p = klantPatch({ content_type: 'post', ...invoer, ...(invoer.platforms || invoer.platform ? {} : { platforms: [] }) })
  return p as ReturnType<typeof klantNieuw>
}

/** Een klant mag enkel een item verwijderen dat hij zelf inplande en dat wij nog niet oppakten (concept). */
export const magKlantVerwijderen = (item: { klant_aangemaakt_op?: string | null; status: string }) => !!item.klant_aangemaakt_op && item.status === 'draft'
