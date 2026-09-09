import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { getAdminEmails } from '@/lib/email'

/**
 * Workspaces binnen Aanbestedingen.
 *
 * Een workspace is een onderwerp met een eigen zoekfilter bij
 * publicprocurement.be: "Software & IT", "Marketing", "Advertising". Hij wordt
 * in de module zelf aangemaakt door een beheerder.
 *
 * Aan een workspace hangt OPTIONEEL één werknemer:
 *  • wél een werknemer → die ziet de workspace en krijgt de mails;
 *  • géén werknemer    → enkel beheerders zien hem, en de mails gaan naar
 *                        info@nextgenmedia.be.
 *
 * Dit bestand is de enige plek waar die regel staat. Voeg nergens anders een
 * losse `eigenaar === user.id`-controle toe: dan lopen zichtbaarheid en
 * mailontvangers uit elkaar en merkt niemand dat, tot iemand post krijgt over
 * een dossier dat hij niet kan openen.
 */

export type Workspace = {
  id: string
  naam: string
  short_link: string
  include_closed: boolean
  eigenaar: string | null
  ai_top_x: number
  mail_drempel: number
  auto_enabled: boolean
  auto_dagen: number[]
  auto_uur: number
}

/** Zichtbaarheid. Een beheerder ziet alles; een werknemer enkel wat aan hem hangt. */
export function magBij(ws: { eigenaar: string | null }, userId: string, isAdmin: boolean): boolean {
  if (isAdmin) return true
  return !!ws.eigenaar && ws.eigenaar === userId
}

/**
 * Eén workspace ophalen mét de toegangscontrole erin. Geeft null wanneer hij
 * niet bestaat óf de gebruiker er niet bij mag — bewust hetzelfde antwoord, zodat
 * je via deze route niet kan aftasten welke workspaces er bestaan.
 */
export async function workspaceVoor(
  id: string, userId: string, isAdmin: boolean,
): Promise<Workspace | null> {
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from('aanbestedingen_filters')
    .select('*')
    .eq('id', id)
    .maybeSingle()
  if (!data) return null
  const ws = data as Workspace
  return magBij(ws, userId, isAdmin) ? ws : null
}

/** Alle workspaces die deze gebruiker mag zien. */
export async function workspacesVoor(userId: string, isAdmin: boolean): Promise<Workspace[]> {
  const admin = createAdminSupabaseClient()
  let q = admin.from('aanbestedingen_filters').select('*').order('naam')
  // Niet-beheerder: enkel de zijne. `eq` laat rijen met eigenaar NULL vanzelf
  // vallen, en dat is precies de bedoeling.
  if (!isAdmin) q = q.eq('eigenaar', userId)
  const { data } = await q
  return (data ?? []) as Workspace[]
}

/**
 * Wie krijgt de mails over deze workspace?
 *
 * Hangt er een werknemer aan, dan hij. Zo niet, dan de beheerders — in de
 * praktijk info@nextgenmedia.be. Nooit allebei: dan zou iemand dubbel post
 * krijgen zodra je een werknemer koppelt.
 */
export async function ontvangersVoor(ws: { eigenaar: string | null }): Promise<string[]> {
  if (ws.eigenaar) {
    const admin = createAdminSupabaseClient()
    const { data } = await admin
      .from('staff_members')
      .select('email, active')
      .eq('auth_user_id', ws.eigenaar)
      .maybeSingle()
    const rij = data as { email: string | null; active: boolean } | null
    // Een gedeactiveerde werknemer krijgt geen post meer; dan vallen we terug
    // op de beheerders, zodat een signaal nooit stilletjes nergens aankomt.
    if (rij?.email && rij.active !== false) return [rij.email]
  }
  return await getAdminEmails()
}
