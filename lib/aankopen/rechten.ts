import 'server-only'
import { getSessionUser, getUserRole, getStaffRow } from '@/lib/supabase/server'
import { FOUNDER_EMAILS } from '@/lib/founders'

/**
 * Rechten binnen Aankopen — bovenop de bestaande lagen (staff-guard +
 * module-afscherming in de middleware), per aanvraag.
 *
 * Admins en zaakvoerders mogen alles. Een werknemer met de module Aankopen
 * mag zijn eigen concept- of wachtende aanvraag aanpassen en verwijderen en
 * zijn eigen bewijsdocument downloaden; meer kan via drie losse sleutels in
 * dezelfde permissielijst (staff_members.permissions):
 *   purchase_request_edit · purchase_request_delete · purchase_certificate_download
 * Geen nieuw rollensysteem — enkel deze sleutels naast de modulesleutels.
 */

export const RECHT_BEWERKEN = 'purchase_request_edit'
export const RECHT_VERWIJDEREN = 'purchase_request_delete'
export const RECHT_BEWIJS = 'purchase_certificate_download'

export type AankoopActor = { id: string; email: string; isAdmin: boolean; isFounder: boolean; permissions: string[] }

export type AankoopRij = {
  id: string; status: string; requester_email: string | null; cost_entry_id: string | null; deleted_at?: string | null
}

export type AankoopRechten = {
  bewerken: boolean; verwijderen: boolean; bewijs: boolean; herstellen: boolean
  /** Reden waarom aanpassen geblokkeerd is, los van wie het vraagt. */
  blokkade: string | null
}

export { BEVESTIGD, NIET_DEFINITIEF } from './status'
import { BEVESTIGD, NIET_DEFINITIEF } from './status'

export async function laadAankoopActor(): Promise<AankoopActor | null> {
  const user = await getSessionUser()
  if (!user) return null
  const email = (user.email ?? '').toLowerCase()
  const isAdmin = (await getUserRole(user.id)) === 'admin'
  const staff = isAdmin ? null : await getStaffRow(user.id)
  if (!isAdmin && (!staff || staff.active === false)) return null
  return { id: user.id, email, isAdmin, isFounder: FOUNDER_EMAILS.map((e) => e.toLowerCase()).includes(email), permissions: staff?.permissions ?? [] }
}

/** Waarom mag deze aanvraag (voor niemand) inhoudelijk aangepast worden? */
export function bewerkBlokkade(p: AankoopRij): string | null {
  if (p.deleted_at) return 'Deze aanvraag is verwijderd. Herstel ze eerst vanuit het archief.'
  if (p.cost_entry_id) return 'Deze aanvraag is al als kost geboekt. Pas de kost aan in Financiën of maak een nieuwe aanvraag.'
  if (p.status === 'rejected') return 'Een afgekeurde aanvraag kan niet worden aangepast. Maak een nieuwe aanvraag.'
  return null
}

export function rechtenVoor(actor: AankoopActor, p: AankoopRij): AankoopRechten {
  const baas = actor.isAdmin || actor.isFounder
  const eigen = (p.requester_email ?? '').toLowerCase() === actor.email
  const nietDefinitief = NIET_DEFINITIEF.includes(p.status)
  const blokkade = bewerkBlokkade(p)
  return {
    blokkade,
    bewerken: !blokkade && (baas || (eigen && nietDefinitief) || actor.permissions.includes(RECHT_BEWERKEN)),
    // Een bevestigde (financieel relevante) aanvraag verwijderen: enkel admin/zaakvoerder.
    verwijderen: !p.deleted_at && (baas || (nietDefinitief && (eigen || actor.permissions.includes(RECHT_VERWIJDEREN)))),
    bewijs: baas || eigen || actor.permissions.includes(RECHT_BEWIJS),
    herstellen: baas,
  }
}
