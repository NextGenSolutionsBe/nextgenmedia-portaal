import 'server-only'
import { cache } from 'react'
import { createAdminSupabaseClient, getSessionUser, getUserRole, getStaffRow } from '@/lib/supabase/server'
import { FOUNDER_EMAILS } from '@/lib/founders'
import {
  samenvoegen, standaardInstellingen, moduleBeschikbaar, magActie, rolVanStaff, MODULE_INSTELLINGEN_KEY,
  type AlleInstellingen, type InstellingenSleutel, type Persoon, type Actie, type Rol,
} from './model'

/**
 * Serverlaag van de centrale instellingen: lezen (met veilige terugval),
 * schrijven per sleutel (atomisch: één upsert) en de "persoon" van de
 * ingelogde gebruiker (rol + modules) om rechten mee te berekenen.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

/** Alle instellingen, één keer per verzoek. Faalt de lezing, dan de standaard. */
export const leesInstellingen = cache(async (): Promise<AlleInstellingen> => {
  try {
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('app_settings').select('key, value')
    if (error) return standaardInstellingen()
    const ruw: Partial<Record<InstellingenSleutel, unknown>> = {}
    for (const r of (data ?? []) as { key: string; value: unknown }[]) (ruw as Record<string, unknown>)[r.key] = r.value
    return samenvoegen(ruw)
  } catch {
    return standaardInstellingen()
  }
})

/** Eén sleutel opslaan (één upsert = atomisch). Geeft de vorige waarde terug voor het logboek. */
export async function bewaarInstelling(admin: Admin, sleutel: InstellingenSleutel, waarde: unknown, actorEmail: string | null): Promise<{ oud: unknown }> {
  const { data: bestaand } = await admin.from('app_settings').select('value').eq('key', sleutel).maybeSingle()
  const { error } = await admin.from('app_settings').upsert({ key: sleutel, value: waarde, updated_at: new Date().toISOString(), updated_by_email: actorEmail }, { onConflict: 'key' })
  if (error) throw new Error(error.message)
  return { oud: bestaand?.value ?? null }
}

export type IngelogdePersoon = Persoon & {
  userId: string; email: string; naam: string | null
  isAdmin: boolean; isFounder: boolean
  staffId: string | null
}

/** Rol + modules van de ingelogde interne gebruiker; null = geen intern account. */
export const leesPersoon = cache(async (): Promise<IngelogdePersoon | null> => {
  const user = await getSessionUser()
  if (!user) return null
  const email = (user.email ?? '').toLowerCase()
  const isFounder = FOUNDER_EMAILS.map((e) => e.toLowerCase()).includes(email)
  if ((await getUserRole(user.id)) === 'admin') {
    return { userId: user.id, email, naam: null, isAdmin: true, isFounder, staffId: null, rol: 'hoofdbeheerder', modules: null }
  }
  const staff = await getStaffRow(user.id) as ({ id?: string; active?: boolean; permissions?: string[]; name?: string | null; rol?: string } | null)
  if (!staff || staff.active === false) return null
  return { userId: user.id, email, naam: staff.name ?? null, isAdmin: false, isFounder, staffId: staff.id ?? null, rol: rolVanStaff(staff.rol), modules: Array.isArray(staff.permissions) ? staff.permissions : [] }
})

/** Mag de ingelogde gebruiker de instellingen beheren? Hoofdbeheerder altijd; beheerder via de rechtenmatrix. */
export async function magInstellingenBeheren(): Promise<IngelogdePersoon | null> {
  const persoon = await leesPersoon()
  if (!persoon) return null
  if (persoon.isAdmin) return persoon
  const inst = await leesInstellingen()
  return moduleBeschikbaar(inst, persoon, MODULE_INSTELLINGEN_KEY) && magActie(inst, persoon, MODULE_INSTELLINGEN_KEY, 'instellingen') ? persoon : null
}

/** Rechtencontrole voor routes: mag deze persoon deze actie in deze module? */
export async function magIk(moduleKey: string, actie: Actie): Promise<IngelogdePersoon | null> {
  const persoon = await leesPersoon()
  if (!persoon) return null
  const inst = await leesInstellingen()
  return magActie(inst, persoon, moduleKey, actie) ? persoon : null
}

/** Persoonlijk verborgen tabbladen van de ingelogde gebruiker. */
export const leesVoorkeuren = cache(async (userId: string): Promise<string[]> => {
  try {
    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('gebruikers_voorkeuren').select('verborgen_modules').eq('auth_user_id', userId).maybeSingle()
    return Array.isArray(data?.verborgen_modules) ? (data!.verborgen_modules as string[]) : []
  } catch { return [] }
})

export type { Rol }
