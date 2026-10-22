// Community management — pure regels (client-safe, getest in tests/community.test.ts).
// Gedeeld door de sync, de inbox in het beheer en de MCP-tools (die laatste in
// .mjs met dezelfde regels: lib/mcp/community.mjs — hou ze gelijk).

export const CATEGORIEEN = ['luchtig', 'vraag', 'kritiek', 'negatief_zonder_inhoud', 'toxisch', 'trefwoord', 'overig'] as const
export type Categorie = (typeof CATEGORIEEN)[number]
export const CATEGORIE_LABEL: Record<Categorie, string> = {
  luchtig: 'Luchtig', vraag: 'Vraag', kritiek: 'Kritiek', negatief_zonder_inhoud: 'Negatief zonder inhoud', toxisch: 'Toxisch', trefwoord: 'Trefwoord', overig: 'Overig',
}

export const STATUSSEN = ['nieuw', 'te_beantwoorden', 'bij_klant', 'klant_gekozen', 'verstuurd', 'genegeerd', 'verlopen', 'fout'] as const
export type Status = (typeof STATUSSEN)[number]
export const STATUS_LABEL: Record<Status, string> = {
  nieuw: 'Nieuw', te_beantwoorden: 'Te beantwoorden', bij_klant: 'Bij klant', klant_gekozen: 'Klant koos', verstuurd: 'Verstuurd',
  genegeerd: 'Genegeerd', verlopen: 'Verlopen', fout: 'Fout bij versturen',
}
/** Open = er moet nog iets mee gebeuren. */
export const OPEN_STATUSSEN: Status[] = ['nieuw', 'te_beantwoorden', 'bij_klant', 'klant_gekozen']
export const isOpen = (s: string) => (OPEN_STATUSSEN as string[]).includes(s)
export const isCategorie = (v: unknown): v is Categorie => typeof v === 'string' && (CATEGORIEEN as readonly string[]).includes(v)
export const isStatus = (v: unknown): v is Status => typeof v === 'string' && (STATUSSEN as readonly string[]).includes(v)

/**
 * Tot wanneer kan er nog geantwoord worden (grenzen van Metricool):
 * Facebook/Instagram: comment 24 uur, DM 7 dagen na ontvangst. Andere netwerken: geen gekende grens.
 */
export function antwoordMogelijkTot(bron: 'comment' | 'dm', netwerk: string, ontvangenOp: string | null): string | null {
  if (!ontvangenOp || (netwerk !== 'instagram' && netwerk !== 'facebook')) return null
  const t = Date.parse(ontvangenOp)
  if (Number.isNaN(t)) return null
  return new Date(t + (bron === 'comment' ? 24 : 7 * 24) * 3600_000).toISOString()
}

/** Status na het indelen (community_verwerken). */
export function statusNaIndelen(categorie: Categorie, klantKeurtGoed: boolean): Status {
  if (categorie === 'negatief_zonder_inhoud') return 'genegeerd'
  if (categorie === 'vraag' || categorie === 'kritiek') return klantKeurtGoed ? 'bij_klant' : 'te_beantwoorden'
  return 'te_beantwoorden'
}

export type Voorstel = { tekst: string; toelichting?: string | null }
/** Voorstellen schoonmaken: 0–5 stuks, tekst verplicht, max 2000 tekens. */
export function schoneVoorstellen(v: unknown): Voorstel[] {
  if (!Array.isArray(v)) return []
  return v
    .map((x) => (typeof x === 'string' ? { tekst: x } : { tekst: String((x as Voorstel)?.tekst ?? ''), toelichting: (x as Voorstel)?.toelichting ? String((x as Voorstel).toelichting).slice(0, 500) : null }))
    .map((x) => ({ ...x, tekst: x.tekst.trim().slice(0, 2000) }))
    .filter((x) => x.tekst)
    .slice(0, 5)
}

/** Mag dit bericht nu verstuurd worden? null = ja, anders de reden. */
export function verstuurBlokkade(b: { status: string; antwoord_mogelijk_tot: string | null }, tekst: string, bevestigdDoor: string, nu = Date.now()): string | null {
  if (!bevestigdDoor.trim()) return 'Wie bevestigde deze tekst? (bevestigd_door is leeg)'
  if (!tekst.trim()) return 'De tekst is leeg.'
  if (b.status !== 'te_beantwoorden' && b.status !== 'klant_gekozen') return `Dit bericht staat op "${STATUS_LABEL[b.status as Status] ?? b.status}"; versturen kan enkel bij "Te beantwoorden" of "Klant koos".`
  if (b.antwoord_mogelijk_tot && Date.parse(b.antwoord_mogelijk_tot) <= nu) return 'De termijn om te antwoorden is voorbij; dit kan enkel nog in de app van het netwerk zelf.'
  return null
}

/** Resterende tijd tot de deadline, als korte tekst en of het dringend is (< 4 uur). */
export function resterend(deadline: string | null, nu = Date.now()): { tekst: string; dringend: boolean; voorbij: boolean } | null {
  if (!deadline) return null
  const ms = Date.parse(deadline) - nu
  if (Number.isNaN(ms)) return null
  if (ms <= 0) return { tekst: 'verlopen', dringend: true, voorbij: true }
  const u = Math.floor(ms / 3600_000), m = Math.floor((ms % 3600_000) / 60_000)
  const tekst = u >= 48 ? `${Math.floor(u / 24)} d` : u >= 1 ? `${u} u ${m} min` : `${m} min`
  return { tekst, dringend: ms < 4 * 3600_000, voorbij: false }
}

/** Handmatige statuswijziging (inbox en community_status): welke overgangen mogen. */
export function magNaarStatus(van: string, naar: string): boolean {
  if (naar === 'genegeerd') return isOpen(van) || van === 'fout'
  if (naar === 'nieuw') return isOpen(van) || van === 'genegeerd' || van === 'fout'
  if (naar === 'bij_klant') return van === 'nieuw' || van === 'te_beantwoorden' || van === 'fout'
  if (naar === 'te_beantwoorden') return van === 'bij_klant' || van === 'nieuw' || van === 'fout' || van === 'klant_gekozen'
  return false
}
