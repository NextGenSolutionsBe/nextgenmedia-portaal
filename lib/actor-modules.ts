import 'server-only'
import { getSessionUser, getUserRole, getStaffRow } from '@/lib/supabase/server'

export type Actor = {
  userId: string
  isAdmin: boolean
  /** null = admin (alles); anders de toegestane module-keys van de werknemer. */
  modules: string[] | null
}

/**
 * Wie is de ingelogde admin/werknemer en welke modules mag die zien?
 * Rol + rechten worden via de SERVICE-ROLE gelezen (user_roles heeft een
 * restrictieve policy waardoor een niet-admin zijn eigen rij niet kan lezen).
 *
 * Gebruik dit voor shell-brede endpoints (globale zoek, notificaties) die zowel
 * admin als werknemer moeten bedienen: de route filtert dan zélf per module,
 * i.p.v. de werknemer volledig buiten te sluiten.
 */
export async function getActor(): Promise<Actor | null> {
  // Alle drie de lezingen zijn gedeeld binnen één verzoek (React cache in
  // lib/supabase/server.ts), dus een route die hiernaast nog een guard
  // aanroept betaalt daar geen tweede rondgang naar Supabase voor.
  const user = await getSessionUser()
  if (!user) return null

  if ((await getUserRole(user.id)) === 'admin') return { userId: user.id, isAdmin: true, modules: null }

  const staff = await getStaffRow(user.id)
  if (!staff || staff.active === false) return null

  const perms = Array.isArray(staff.permissions) ? (staff.permissions as string[]) : []
  return { userId: user.id, isAdmin: false, modules: perms }
}

/** Mag deze actor de gegeven module zien? Admin altijd. */
export function actorCanSee(actor: Actor, moduleKey: string): boolean {
  return actor.modules === null || actor.modules.includes(moduleKey)
}
