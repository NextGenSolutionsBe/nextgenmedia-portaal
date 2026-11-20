/**
 * Contentkalender personaliseren — pure regels (getest in tests/kalender-stijl.test.ts).
 *
 * Per klantkalender, en klant en team zien hetzelfde:
 *  - eigen labels (bv. "Nieuwbouwproject", "Renovatiepand" bij Era Nobis) die
 *    enkel in die kalender bestaan;
 *  - een eigen naam en kleur per type (post, reel, story, carrousel) en per
 *    kanaal (Meta, TikTok, LinkedIn, YouTube, Pinterest, X);
 *  - een kleur per fase;
 *  - waarop de vakjes in de kalender hun kleur krijgen: status, type, kanaal,
 *    label of overal één kleur (`blokKleur`).
 * Labels en kleuren zijn ordening, geen inhoud: ze veranderen niets aan een post.
 */
import { KANAAL_SLUGS, kanaalLabel, normaliseerKanaal, normaliseerKanalen, publicatieKanalen } from '@/lib/social-platforms'

export type ContentLabel = { id: string; naam: string; kleur: string }
export type FaseKey = 'draft' | 'ready_for_review' | 'approved' | 'changes_requested' | 'scheduled' | 'published'
export type FaseKleuren = Partial<Record<FaseKey, string>>
export type TypeKey = 'post' | 'reel' | 'story' | 'carousel'
export type TypeKleuren = Partial<Record<TypeKey, string>>
export type TypeNamen = Partial<Record<TypeKey, string>>
/** Per kanaalsleutel (KANAAL_SLUGS: meta, tiktok, linkedin, youtube, pinterest, twitter). */
export type KanaalKleuren = Partial<Record<string, string>>
export type KanaalNamen = Partial<Record<string, string>>
/** Waarop de vakjes hun kleur krijgen. "Planning" is een eigen weergave van het team en wordt niet bewaard. */
export type BlokKleur = 'status' | 'type' | 'kanaal' | 'label' | 'een'
export type KalenderStijl = {
  labels: ContentLabel[]
  faseKleuren: FaseKleuren
  typeKleuren: TypeKleuren
  typeNamen: TypeNamen
  kanaalKleuren: KanaalKleuren
  kanaalNamen: KanaalNamen
  /** null = nog niet gekozen: Type als er eigen typekleuren zijn, anders Status. */
  blokKleur: BlokKleur | null
  /** De kleur bij "Eén kleur". */
  eenKleur: string | null
}

export const BLOK_KLEUREN: { key: BlokKleur; label: string; uitleg: string }[] = [
  { key: 'status', label: 'Status', uitleg: 'Concept, feedback gevraagd, goedgekeurd …' },
  { key: 'type', label: 'Type', uitleg: 'Post, reel, story, carrousel' },
  { key: 'kanaal', label: 'Kanaal', uitleg: 'Meta, TikTok, LinkedIn … (het eerste kanaal van de post)' },
  { key: 'label', label: 'Label', uitleg: 'De kleur van het eerste eigen label; zonder label wit' },
  { key: 'een', label: 'Eén kleur', uitleg: 'Alle vakjes in dezelfde kleur' },
]
export const isBlokKleur = (v: unknown): v is BlokKleur => BLOK_KLEUREN.some((b) => b.key === v)

export const FASES: { key: FaseKey; label: string; standaard: string }[] = [
  { key: 'draft', label: 'Concept', standaard: '#9ca3af' },
  { key: 'ready_for_review', label: 'Feedback gevraagd', standaard: '#f59e0b' },
  { key: 'approved', label: 'Goedgekeurd', standaard: '#22c55e' },
  { key: 'changes_requested', label: 'Aanpassing gevraagd', standaard: '#ef4444' },
  { key: 'scheduled', label: 'Ingepland', standaard: '#3b82f6' },
  { key: 'published', label: 'Gepubliceerd', standaard: '#a855f7' },
]

/** De soorten posts in de kalender (social_content_items.content_type), met een eigen standaardkleur. */
export const TYPES: { key: TypeKey; label: string; standaard: string }[] = [
  { key: 'post', label: 'Post', standaard: '#3b82f6' },
  { key: 'reel', label: 'Reel', standaard: '#ec4899' },
  { key: 'story', label: 'Story', standaard: '#f97316' },
  { key: 'carousel', label: 'Carrousel', standaard: '#14b8a6' },
]

/** Standaardkleur per kanaal (KANAAL_SLUGS). */
export const KANAAL_STANDAARD: Record<string, string> = {
  meta: '#3b82f6', tiktok: '#111827', linkedin: '#06b6d4', youtube: '#ef4444', pinterest: '#f97316', twitter: '#6b7280',
}

/** Kleuren om uit te kiezen voor labels, fases en types. */
export const KLEUREN = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6', '#6366f1', '#a855f7', '#ec4899', '#6b7280', '#111827']

const HEX = /^#[0-9a-f]{6}$/i
export const isKleur = (v: unknown): v is string => typeof v === 'string' && HEX.test(v)
export const isFase = (v: unknown): v is FaseKey => FASES.some((f) => f.key === v)
export const isType = (v: unknown): v is TypeKey => TYPES.some((t) => t.key === v)

/** De kleur van een soort post: eigen kleur van de klant, anders de standaard (onbekend = grijs). */
export function typeKleur(type: string, eigen: TypeKleuren): string {
  if (isType(type)) return eigen[type] ?? TYPES.find((t) => t.key === type)!.standaard
  return '#6b7280'
}

/** Naam van een soort post zoals we hem tonen ("carousel" → "Carrousel"). */
export const typeLabel = (type: string): string => TYPES.find((t) => t.key === type)?.label ?? (type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Post')

type Namen = Pick<KalenderStijl, 'typeNamen' | 'kanaalNamen' | 'kanaalKleuren'>

/** Naam van een type in deze kalender: eigen naam, anders de standaard. */
export const typeNaam = (type: string, st?: Partial<Namen> | null): string => (isType(type) ? st?.typeNamen?.[type] : undefined) ?? typeLabel(type)

export const isKanaal = (v: unknown): v is string => typeof v === 'string' && KANAAL_SLUGS.includes(v)

/** Naam van een kanaal in deze kalender (instagram/facebook vallen onder Meta). */
export function kanaalNaam(slug: string, st?: Partial<Namen> | null): string {
  const k = normaliseerKanaal(slug)
  return st?.kanaalNamen?.[k] ?? kanaalLabel(k)
}

/** Kleur van een kanaal: eigen kleur, anders de standaard (onbekend = grijs). */
export function kanaalKleur(slug: string, st?: Partial<Namen> | null): string {
  const k = normaliseerKanaal(slug)
  return st?.kanaalKleuren?.[k] ?? KANAAL_STANDAARD[k] ?? '#6b7280'
}

/**
 * De kanaallabels op een vakje. Meta staat als Instagram + Facebook, tenzij de
 * klant Meta een eigen naam gaf: dan één label met die naam. `kleur` = eigen
 * kleur van het kanaal (null = de vaste stijl).
 */
export function kanaalChips(platforms: unknown, st?: Partial<Namen> | null): { slug: string; label: string; kleur: string | null }[] {
  const uit: { slug: string; label: string; kleur: string | null }[] = []
  for (const k of publicatieKanalen(platforms)) {
    const ouder = normaliseerKanaal(k.slug)
    const eigenNaam = st?.kanaalNamen?.[ouder]
    const kleur = st?.kanaalKleuren?.[ouder] ?? null
    if (eigenNaam) {
      if (!uit.some((c) => c.slug === ouder)) uit.push({ slug: ouder, label: eigenNaam, kleur })
    } else uit.push({ slug: k.slug, label: k.label, kleur })
  }
  return uit
}

/** Welke kleur krijgt het vakje? null = de kleur van de status (of de planning). */
export function blokKleurHex(
  it: { content_type: string; platforms?: string[] | null; platform?: string | null; labels?: string[] | null },
  st: KalenderStijl, modus: BlokKleur | 'planning',
): string | null {
  switch (modus) {
    case 'type': return typeKleur(it.content_type, st.typeKleuren)
    case 'kanaal': {
      const k = normaliseerKanalen(it.platforms?.length ? it.platforms : it.platform ? [it.platform] : [])[0]
      return k ? kanaalKleur(k, st) : '#6b7280'
    }
    case 'label': {
      const l = (it.labels ?? []).map((id) => st.labels.find((x) => x.id === id)).find(Boolean)
      return l ? l.kleur : null
    }
    case 'een': return isKleur(st.eenKleur) ? st.eenKleur : '#3b82f6'
    default: return null
  }
}

/** Waarop kleurt deze kalender als niemand iets koos? */
export const standaardBlokKleur = (st: KalenderStijl): BlokKleur => st.blokKleur ?? (Object.keys(st.typeKleuren ?? {}).length ? 'type' : 'status')

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

/** Enkel gekende types met een geldige kleur; leeg = standaardkleur. */
export function controleerTypeKleuren(v: unknown): TypeKleuren {
  const uit: TypeKleuren = {}
  if (!v || typeof v !== 'object') return uit
  for (const [k, kleur] of Object.entries(v as Record<string, unknown>)) {
    if (isType(k) && isKleur(kleur)) uit[k] = kleur.toLowerCase()
  }
  return uit
}

/** Eigen namen: enkel gekende sleutels, spaties opgekuist, hoogstens 30 tekens; leeg = standaardnaam. */
export function controleerNamen(v: unknown, isSleutel: (k: string) => boolean): Record<string, string> {
  const uit: Record<string, string> = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return uit
  for (const [k, naam] of Object.entries(v as Record<string, unknown>)) {
    if (!isSleutel(k) || typeof naam !== 'string') continue
    const n = naam.replace(/\s+/g, ' ').trim().slice(0, 30)
    if (n) uit[k] = n
  }
  return uit
}

/** Enkel gekende kanalen met een geldige kleur; leeg = standaardkleur. */
export function controleerKanaalKleuren(v: unknown): KanaalKleuren {
  const uit: KanaalKleuren = {}
  if (!v || typeof v !== 'object' || Array.isArray(v)) return uit
  for (const [k, kleur] of Object.entries(v as Record<string, unknown>)) {
    if (isKanaal(k) && isKleur(kleur)) uit[k] = kleur.toLowerCase()
  }
  return uit
}

/**
 * Een aanpassing van de weergave (actie "weergave"): enkel de velden die
 * meekomen, nagekeken, als kolommen van content_kalender_stijl.
 */
export function controleerWeergave(b: Record<string, unknown>): { kolommen: Record<string, unknown> } | { fout: string } {
  const k: Record<string, unknown> = {}
  if ('typeKleuren' in b) k.type_kleuren = controleerTypeKleuren(b.typeKleuren)
  if ('typeNamen' in b) k.type_namen = controleerNamen(b.typeNamen, isType)
  if ('kanaalKleuren' in b) k.kanaal_kleuren = controleerKanaalKleuren(b.kanaalKleuren)
  if ('kanaalNamen' in b) k.kanaal_namen = controleerNamen(b.kanaalNamen, isKanaal)
  if ('blokKleur' in b) {
    if (b.blokKleur !== null && !isBlokKleur(b.blokKleur)) return { fout: 'Onbekende keuze voor de kleur van de vakjes.' }
    k.blok_kleur = b.blokKleur
  }
  if ('eenKleur' in b) {
    if (b.eenKleur !== null && !isKleur(b.eenKleur)) return { fout: 'Ongeldige kleur.' }
    k.een_kleur = typeof b.eenKleur === 'string' ? b.eenKleur.toLowerCase() : null
  }
  if (!Object.keys(k).length) return { fout: 'Niets om te bewaren.' }
  return { kolommen: k }
}

/** Een rij van content_kalender_stijl (select '*', dus ook vóór de migratie) naar de stijl, zonder labels. */
export function stijlUitRij(r: Record<string, unknown> | null | undefined): Omit<KalenderStijl, 'labels'> {
  return {
    faseKleuren: controleerFaseKleuren(r?.fase_kleuren),
    typeKleuren: controleerTypeKleuren(r?.type_kleuren),
    typeNamen: controleerNamen(r?.type_namen, isType),
    kanaalKleuren: controleerKanaalKleuren(r?.kanaal_kleuren),
    kanaalNamen: controleerNamen(r?.kanaal_namen, isKanaal),
    blokKleur: isBlokKleur(r?.blok_kleur) ? r!.blok_kleur as BlokKleur : null,
    eenKleur: isKleur(r?.een_kleur) ? (r!.een_kleur as string).toLowerCase() : null,
  }
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

export const leegStijl: KalenderStijl = { labels: [], faseKleuren: {}, typeKleuren: {}, typeNamen: {}, kanaalKleuren: {}, kanaalNamen: {}, blokKleur: null, eenKleur: null }

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
