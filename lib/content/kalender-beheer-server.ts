import 'server-only'

// Server-kant van het kalenderbeheer door klanten: rechten lezen en activiteit loggen.

import { magKalenderBeheren, type BeheerConfig } from './kalender-beheer'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export async function leesBeheerConfig(admin: Admin, clientId: string): Promise<BeheerConfig | null> {
  const { data, error } = await admin.from('clients').select('kalender_beheer, kalender_beheer_wie, kalender_beheer_eigenaar').eq('id', clientId).maybeSingle()
  if (error) return null   // vóór de migratie: geen beheer
  return (data ?? null) as BeheerConfig | null
}

export async function magSessieBeheren(admin: Admin, session: { clientId: string; isOwner: boolean }, kanEdit: boolean): Promise<boolean> {
  return magKalenderBeheren(await leesBeheerConfig(admin, session.clientId), { isOwner: session.isOwner, kanEdit })
}

export type ActiviteitRol = 'klant' | 'nextgenmedia'
/** Activiteit per contentitem (best effort; breekt nooit de hoofdactie). Nooit gevoelige gegevens in details. */
export async function logContentActiviteit(admin: Admin, rij: { item_id: string; client_id: string | null; door: string | null; rol: ActiviteitRol; actie: string; details?: Record<string, unknown> | null }) {
  try { await admin.from('social_content_activiteit').insert({ ...rij, details: rij.details ?? null }) } catch { /* tabel nog niet gemigreerd */ }
}

export async function leesContentActiviteit(admin: Admin, itemId: string) {
  const { data } = await admin.from('social_content_activiteit').select('op, door, rol, actie, details').eq('item_id', itemId).order('op', { ascending: false }).limit(100)
  return (data ?? []) as { op: string; door: string | null; rol: ActiviteitRol; actie: string; details: Record<string, unknown> | null }[]
}
