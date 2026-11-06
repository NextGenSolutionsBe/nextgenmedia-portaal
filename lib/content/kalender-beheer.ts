// Contentkalender beheren door de klant — pure regels (getest in tests/kalender-beheer.test.ts).
//
// Per klant instelbaar (clients.kalender_beheer, standaard UIT). Aan = alle
// gebruikers van de klant, of enkel geselecteerde: de eigenaar (vinkje) en
// subaccounts met het bestaande portaalrecht social_media.edit.
// Zonder beheer behoudt de klant de gewone werking: bekijken, goedkeuren, feedback.
// Sinds de rollen per klant (lib/content/kalender-rol.ts) geldt dit oude beheer
// enkel nog voor klanten die op "Standaard" staan.

export type BeheerConfig = { kalender_beheer: boolean; kalender_beheer_wie: string; kalender_beheer_eigenaar: boolean }

export function magKalenderBeheren(cfg: BeheerConfig | null | undefined, gebruiker: { isOwner: boolean; kanEdit: boolean }): boolean {
  if (!cfg?.kalender_beheer) return false
  if (cfg.kalender_beheer_wie !== 'geselecteerd') return true
  return gebruiker.isOwner ? cfg.kalender_beheer_eigenaar : gebruiker.kanEdit
}

export type Status = 'draft' | 'ready_for_review' | 'approved' | 'changes_requested' | 'scheduled' | 'published'

/**
 * Statusovergangen voor een beherende klant. De bestaande goedkeuring wordt
 * niet overgeslagen: een item dat bij de klant ter goedkeuring ligt
 * ("Feedback gevraagd") gaat enkel verder via Goedkeuren of Aanpassing vragen,
 * en een item met een gevraagde aanpassing ligt bij NextGenMedia. Eigen concepten mag de klant zelf
 * goedkeuren en inplannen.
 */
const OVERGANGEN: Record<Status, Status[]> = {
  draft: ['approved', 'scheduled'],
  ready_for_review: [],
  changes_requested: [],
  approved: ['scheduled', 'published', 'draft'],
  scheduled: ['published', 'approved'],
  published: ['scheduled'],
}
export const klantOvergangen = (van: string): Status[] => OVERGANGEN[van as Status] ?? []
export const magNaarStatus = (van: string, naar: string) => klantOvergangen(van).includes(naar as Status)

export const STATUS_LABEL: Record<Status, string> = {
  draft: 'Concept', ready_for_review: 'Feedback gevraagd', approved: 'Goedgekeurd', changes_requested: 'Aanpassing gevraagd', scheduled: 'Ingepland', published: 'Gepubliceerd',
}

/** Publicatiegegevens bij "Gepubliceerd": datum (standaard vandaag), platform, link (optioneel, http/https). */
export function publicatie(invoer: Record<string, unknown>, vandaag: string, toegestanePlatformen: string[]): { published_at: string; published_platform: string | null; published_url: string | null } {
  const datum = String(invoer.published_at ?? vandaag).slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(datum) || Number.isNaN(Date.parse(datum))) throw new Error('Kies een geldige publicatiedatum.')
  if (datum > vandaag) throw new Error('De publicatiedatum kan niet in de toekomst liggen.')
  const platform = invoer.published_platform ? String(invoer.published_platform) : null
  if (platform && toegestanePlatformen.length && !toegestanePlatformen.includes(platform)) throw new Error('Kies een kanaal van dit item.')
  const url = invoer.published_url ? String(invoer.published_url).trim() : null
  if (url && !/^https?:\/\/[^\s]+\.[^\s]+/i.test(url)) throw new Error('Geef een geldige link (https://…).')
  return { published_at: `${datum}T12:00:00.000Z`, published_platform: platform, published_url: url ? url.slice(0, 1000) : null }
}
