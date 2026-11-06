/**
 * Contentkalender personaliseren — pure regels (getest in tests/kalender-stijl.test.ts).
 *
 * Elke klant heeft eigen labels (bv. "Nieuwbouwproject", "Renovatiepand" bij
 * Era Nobis) die enkel in die kalender bestaan, en kan per fase een eigen kleur
 * kiezen. Klant en team zien dezelfde labels en kleuren. Labels zijn ordening,
 * geen inhoud: een label toevoegen verandert niets aan de status van een post.
 */

export type ContentLabel = { id: string; naam: string; kleur: string }
export type FaseKey = 'draft' | 'ready_for_review' | 'approved' | 'changes_requested' | 'scheduled' | 'published'
export type FaseKleuren = Partial<Record<FaseKey, string>>
export type KalenderStijl = { labels: ContentLabel[]; faseKleuren: FaseKleuren }

export const FASES: { key: FaseKey; label: string; standaard: string }[] = [
  { key: 'draft', label: 'Concept', standaard: '#9ca3af' },
  { key: 'ready_for_review', label: 'Feedback gevraagd', standaard: '#f59e0b' },
  { key: 'approved', label: 'Goedgekeurd', standaard: '#22c55e' },
  { key: 'changes_requested', label: 'Aanpassing gevraagd', standaard: '#ef4444' },
  { key: 'scheduled', label: 'Ingepland', standaard: '#3b82f6' },
  { key: 'published', label: 'Gepubliceerd', standaard: '#a855f7' },
]

/** Kleuren om uit te kiezen voor labels en fases. */
export const KLEUREN = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#6b7280', '#111827']

const HEX = /^#[0-9a-f]{6}$/i
export const isKleur = (v: unknown): v is string => typeof v === 'string' && HEX.test(v)
export const isFase = (v: unknown): v is FaseKey => FASES.some((f) => f.key === v)

/** Naam en kleur van een label uit een verzoek. */
export function controleerLabel(b: { naam?: unknown; kleur?: unknown }): { label: { naam: string; kleur: string } } | { fout: string } {
  const naam = typeof b.naam === 'string' ? b.naam.replace(/\s+/g, ' ').trim() : ''
  if (naam.length < 1) return { fout: 'Geef het label een naam.' }
  if (naam.length > 40) return { fout: 'Een label mag hoogstens 40 tekens hebben.' }
  const kleur = isKleur(b.kleur) ? b.kleur.toLowerCase() : '#6b7280'
  return { label: { naam, kleur } }
}

/** Enkel gekende fases met een geldige kleur; leeg = standaardkleur. */
export function controleerFaseKleuren(v: unknown): FaseKleuren {
  const uit: FaseKleuren = {}
  if (!v || typeof v !== 'object') return uit
  for (const [k, kleur] of Object.entries(v as Record<string, unknown>)) {
    if (isFase(k) && isKleur(kleur)) uit[k] = kleur.toLowerCase()
  }
  return uit
}

/** Enkel labels van deze klant, zonder dubbels, hoogstens 10 per post. */
export function geldigeLabelIds(gevraagd: unknown, vanKlant: Set<string>): string[] {
  if (!Array.isArray(gevraagd)) return []
  return Array.from(new Set(gevraagd.filter((x): x is string => typeof x === 'string' && vanKlant.has(x)))).slice(0, 10)
}

/** Een kleur mengen met wit (t > 0) of zwart (t < 0). */
export function meng(hex: string, t: number): string {
  const n = parseInt(hex.slice(1), 16)
  const kanalen = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  const doel = t >= 0 ? 255 : 0
  const a = Math.abs(t)
  return `#${kanalen.map((c) => Math.round(c + (doel - c) * a).toString(16).padStart(2, '0')).join('')}`
}

/** Leesbare tinten voor een gekleurd vakje: lichte achtergrond, zachte rand, donkere tekst. */
export function tinten(hex: string): { achtergrond: string; rand: string; tekst: string; stip: string } {
  const k = isKleur(hex) ? hex : '#6b7280'
  return { achtergrond: meng(k, 0.88), rand: meng(k, 0.55), tekst: meng(k, -0.55), stip: k }
}

export const leegStijl: KalenderStijl = { labels: [], faseKleuren: {} }

/** Leesbare tekstkleur op een volle kleur: donker op licht (geel, lichtgroen), wit op donker. */
export function tekstOp(hex: string): string {
  const k = isKleur(hex) ? hex : '#6b7280'
  const n = parseInt(k.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return lum > 0.4 ? '#111827' : '#ffffff'
}
