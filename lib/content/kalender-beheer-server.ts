import 'server-only'

// Server-kant van de contentkalender voor klanten: rol en rechten lezen,
// de gedeelde toegangspoort voor portaalroutes, en activiteit loggen.

import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, sessionCan, type PortalSession } from '@/lib/portal-auth'
import type { BeheerConfig } from './kalender-beheer'
import { kalenderRechten, leesKalenderRol, type KalenderRechten } from './kalender-rol'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export async function leesBeheerConfig(admin: Admin, clientId: string): Promise<BeheerConfig | null> {
  const { data, error } = await admin.from('clients').select('kalender_beheer, kalender_beheer_wie, kalender_beheer_eigenaar').eq('id', clientId).maybeSingle()
  if (error) return null   // vóór de migratie: geen beheer
  return (data ?? null) as BeheerConfig | null
}

export { leesKalenderRol }

/** Rechten van deze portaalgebruiker: rol van de klant × eigen portaalrechten. */
export async function kalenderRechtenVoorSessie(admin: Admin, session: PortalSession): Promise<KalenderRechten> {
  const [rol, oudBeheer] = await Promise.all([leesKalenderRol(admin, session.clientId), leesBeheerConfig(admin, session.clientId)])
  return kalenderRechten(rol, oudBeheer, {
    isOwner: session.isOwner,
    perms: {
      view: sessionCan(session, 'social_media', 'view'),
      edit: sessionCan(session, 'social_media', 'edit'),
      feedback: sessionCan(session, 'social_media', 'feedback'),
      approve_scripts: sessionCan(session, 'social_media', 'approve_scripts'),
    },
  })
}

type Poort =
  | { fout: NextResponse }
  | { fout?: undefined; session: PortalSession; admin: ReturnType<typeof createAdminSupabaseClient>; rechten: KalenderRechten; door: string }

/**
 * Gedeelde poort voor elke portaalroute van de contentkalender: ingelogd + actief +
 * kijkrecht (requirePortalPermission), actieve dienst social media en een rol die
 * de kalender opent. Wat daarna mag, beslist de route met `rechten`
 * (lib/content/kalender-rol.ts) — altijd op de eigen, geresolveerde clientId.
 */
export async function kalenderPoort(): Promise<Poort> {
  const g = await requirePortalPermission('social_media', 'view')
  if (!g.ok) return { fout: g.response }
  const admin = createAdminSupabaseClient()
  const { data: svc } = await admin.from('client_services').select('active').eq('client_id', g.session.clientId).eq('service_slug', 'social-media').maybeSingle()
  if (!svc?.active) return { fout: NextResponse.json({ error: 'Social media staat niet actief voor jouw account.' }, { status: 403 }) }
  const rechten = await kalenderRechtenVoorSessie(admin, g.session)
  if (!rechten.bekijken) return { fout: NextResponse.json({ error: 'Je hebt geen toegang tot de contentkalender.' }, { status: 403 }) }
  return { session: g.session, admin, rechten, door: g.session.name || g.session.email || 'Klant' }
}

/** 403 met een uitleg die bij de rol past. */
export const geenRecht = (melding: string) => NextResponse.json({ error: melding }, { status: 403 })

export type ActiviteitRol = 'klant' | 'nextgenmedia'
/** Activiteit per contentitem (best effort; breekt nooit de hoofdactie). Nooit gevoelige gegevens in details. */
export async function logContentActiviteit(admin: Admin, rij: { item_id: string; client_id: string | null; door: string | null; rol: ActiviteitRol; actie: string; details?: Record<string, unknown> | null }) {
  try { await admin.from('social_content_activiteit').insert({ ...rij, details: rij.details ?? null }) } catch { /* tabel nog niet gemigreerd */ }
}

/**
 * Opmerking bij een item: hetzelfde activiteitenlogboek (actie 'opmerking',
 * tekst in details). Anders dan logContentActiviteit NIET stil: een opmerking
 * die niet bewaard werd, moet de schrijver te zien krijgen.
 */
export async function plaatsOpmerking(admin: Admin, rij: { item_id: string; client_id: string | null; door: string | null; rol: ActiviteitRol; tekst: string }) {
  const { error } = await admin.from('social_content_activiteit').insert({ item_id: rij.item_id, client_id: rij.client_id, door: rij.door, rol: rij.rol, actie: 'opmerking', details: { tekst: rij.tekst } })
  if (error) throw new Error('De opmerking kon niet bewaard worden. Probeer het opnieuw.')
}

export async function leesContentActiviteit(admin: Admin, itemId: string) {
  const { data } = await admin.from('social_content_activiteit').select('op, door, rol, actie, details').eq('item_id', itemId).order('op', { ascending: false }).limit(200)
  return (data ?? []) as { op: string; door: string | null; rol: ActiviteitRol; actie: string; details: Record<string, unknown> | null }[]
}
