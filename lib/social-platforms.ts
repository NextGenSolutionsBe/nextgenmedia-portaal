/**
 * De kanalen waarop we content inplannen. Eén lijst, één bron.
 *
 * INSTAGRAM EN FACEBOOK ZIJN SAMEN "META". Je plant er in de praktijk nooit
 * apart voor: dezelfde post gaat naar allebei, en twee losse vinkjes leverden
 * enkel dubbele regels in de kalender op — twee keer dezelfde reel, één keer
 * voor Instagram en één keer voor Facebook. Dat is één stuk werk, dus één
 * kanaal.
 *
 * Oudere content staat nog met 'instagram' of 'facebook' in de databank, en
 * Metricool en ClickUp praten ook in die termen. Daarom bestaat
 * `normaliseerKanaal`: alles wat binnenkomt wordt naar de nieuwe lijst
 * gebracht, zodat een oude regel niet plots een leeg kanaal toont.
 *
 * Pure module — geen server-imports, bruikbaar in client- én servercode.
 */

export type Kanaal = {
  /** Wat er in de databank staat. */
  slug: string
  /** Wat de mens ziet. */
  label: string
}

export const KANALEN: Kanaal[] = [
  { slug: 'meta',      label: 'Meta' },
  { slug: 'tiktok',    label: 'TikTok' },
  { slug: 'linkedin',  label: 'LinkedIn' },
  { slug: 'youtube',   label: 'YouTube' },
  { slug: 'pinterest', label: 'Pinterest' },
  { slug: 'twitter',   label: 'X' },
]

export const KANAAL_SLUGS = KANALEN.map((k) => k.slug)

/** Wat er vroeger apart bestond en nu onder één noemer valt. */
const SAMENGEVOEGD: Record<string, string> = {
  instagram: 'meta',
  facebook: 'meta',
  fb: 'meta',
  ig: 'meta',
  'facebook/instagram': 'meta',
  x: 'twitter',
}

/** Eén kanaalnaam naar de huidige lijst brengen. Onbekend? Dan zoals het was. */
export function normaliseerKanaal(ruw: string): string {
  const k = (ruw ?? '').trim().toLowerCase()
  return SAMENGEVOEGD[k] ?? k
}

/**
 * Een lijst kanalen normaliseren en ontdubbelen. ['instagram','facebook'] wordt
 * dus ['meta'] — precies de dubbele regel die we niet meer willen.
 */
export function normaliseerKanalen(ruw: unknown): string[] {
  const lijst = Array.isArray(ruw) ? ruw : ruw ? [ruw] : []
  const uit: string[] = []
  for (const x of lijst) {
    if (typeof x !== 'string' || !x.trim()) continue
    const k = normaliseerKanaal(x)
    if (!uit.includes(k)) uit.push(k)
  }
  return uit
}

/** Het label voor op het scherm; onbekende sleutels tonen we zoals ze zijn. */
export function kanaalLabel(slug: string): string {
  const k = normaliseerKanaal(slug)
  return KANALEN.find((x) => x.slug === k)?.label
    ?? (k ? k.charAt(0).toUpperCase() + k.slice(1) : '—')
}
