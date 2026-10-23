import 'server-only'
import { magIk, type IngelogdePersoon } from '@/lib/instellingen/laden'
import type { Actor } from './versturen'

/**
 * Rechten voor community management (stafmodule 'community'), server-side:
 *  · bekijken     — inbox en instellingen lezen
 *  · aanpassen    — tekst bewaren, status wijzigen, versturen
 *  · instellingen — schakelaar, kanalen, regels per klant
 * De hoofdbeheerder mag alles (magIk geeft dan altijd een persoon terug).
 */
export async function communityRechten() {
  const [bekijken, aanpassen, instellingen] = await Promise.all([
    magIk('community', 'bekijken'), magIk('community', 'aanpassen'), magIk('community', 'instellingen'),
  ])
  const persoon = bekijken ?? aanpassen ?? instellingen
  return { persoon, bekijken: !!persoon, aanpassen: !!aanpassen, instellingen: !!instellingen }
}

export const actorVan = (p: IngelogdePersoon): Actor => ({ userId: p.userId, email: p.email, naam: p.naam, rol: p.isAdmin ? 'admin' : p.rol })
export const naamVan = (p: IngelogdePersoon) => p.naam || p.email

// ── Schoonmaken van de lijsten uit de instellingen ──────────────────────────

export type CheatItem = { trefwoord: string; antwoord: string; link: string }
export type VoorbeeldItem = { comment: string; antwoord: string }
const t = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max)

export function schoneCheatSheet(v: unknown): CheatItem[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => ({ trefwoord: t(x?.trefwoord, 200), antwoord: t(x?.antwoord, 2000), link: t(x?.link, 500) }))
    .filter((x) => x.trefwoord || x.antwoord || x.link).slice(0, 100)
}
export function schoneVoorbeelden(v: unknown): VoorbeeldItem[] {
  if (!Array.isArray(v)) return []
  return v.map((x) => ({ comment: t(x?.comment, 2000), antwoord: t(x?.antwoord, 2000) }))
    .filter((x) => x.comment || x.antwoord).slice(0, 100)
}
