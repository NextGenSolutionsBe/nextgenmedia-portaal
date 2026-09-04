import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

/**
 * De bellijst: wie moeten we vandaag bellen om een afspraak te bevestigen?
 *
 * Er gaat geen herinneringsmail meer naar een prospect. In plaats daarvan
 * bellen we twee dagen vóór de afspraak zelf even — is de uitnodiging
 * aangekomen, staat het nog. Dat gesprek levert meer op dan een mail die toch
 * niemand leest, en je hoort meteen of iemand afhaakt.
 *
 * Het gaat om de DAG, niet om een tijdstip. Een afspraak op donderdag om 9u en
 * één op donderdag om 17u staan allebei op dinsdag in de lijst; wanneer op
 * dinsdag je belt maakt niet uit.
 */

/** Standaard aantal dagen vooraf. Twee dagen geeft nog ruimte om te verzetten
 *  als er iets misloopt; één dag is vaak te laat om nog iets te regelen. */
export const DAGEN_VOORAF = 2

export type BelItem = {
  appointmentId: string
  startsAt: string
  bedrijf: string | null
  contact: string | null
  telefoon: string | null
  mobiel: string | null
  email: string | null
  pipeline: string | null
  agenda: string | null
  notitie: string | null
  leadId: string | null
  /** Hoeveel dagen tot de afspraak (0 = vandaag). */
  dagenTot: number
  /** Had deze al gebeld moeten zijn? */
  teLaat: boolean
}

/** Dagnummer in Belgische tijd: 0 = vandaag, 1 = morgen, … Losstaand van waar
 *  de server staat, want anders klopt de lijst rond middernacht niet. */
export function dagVerschil(startsAt: string | Date, nu: Date = new Date()): number {
  const dagKey = (d: Date) => {
    const f = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
    })
    return f.format(d)
  }
  const a = dagKey(new Date(startsAt))
  const b = dagKey(nu)
  // Via UTC-middernacht van beide dagen: zo telt een zomertijdsprong niet mee.
  const ms = Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)
  return Math.round(ms / 86_400_000)
}

/**
 * Moet deze afspraak vandaag gebeld worden?
 *
 * Ja vanaf het moment dat hij binnen `dagenVooraf` valt, tot en met de dag zelf.
 * Bewust niet alleen exact op dag twee: wie een dag niet gekeken heeft, moet de
 * achterstand alsnog zien in plaats van dat iemand stilletjes overgeslagen wordt.
 */
export function moetGebeldWorden(dagenTot: number, dagenVooraf = DAGEN_VOORAF): boolean {
  return dagenTot >= 0 && dagenTot <= dagenVooraf
}

type Rij = {
  id: string; starts_at: string; status: string; notes: string | null
  lead_id: string | null; pipeline_id: string | null
  attendee_email: string | null
  sales_contacts: { name: string | null; email: string | null; phone: string | null; mobile: string | null } | null
  sales_leads: { sales_companies: { name: string | null; phone: string | null } | null } | null
}

/**
 * Alles wat de komende dagen op de agenda staat en nog niet bevestigd is.
 *
 * Afspraken die al geweest zijn vallen weg, geannuleerde ook. Een afspraak die
 * je gebeld hebt verdwijnt meteen uit de lijst.
 */
export async function belLijst(dagenVooraf = DAGEN_VOORAF): Promise<{
  tebellen: BelItem[]; later: BelItem[]
}> {
  const admin = createAdminSupabaseClient()

  // Ruim genoeg venster: van gisteren (voor wie te laat is) tot twee weken
  // vooruit, zodat "later" ook iets toont om naar vooruit te kijken.
  const van = new Date(Date.now() - 2 * 86_400_000).toISOString()
  const tot = new Date(Date.now() + 21 * 86_400_000).toISOString()

  const { data, error } = await admin
    .from('sales_appointments')
    .select(`
      id, starts_at, status, notes, lead_id, pipeline_id, attendee_email,
      sales_contacts ( name, email, phone, mobile ),
      sales_leads ( sales_companies ( name, phone ) )
    `)
    .gte('starts_at', van)
    .lte('starts_at', tot)
    .is('bevestigd_op', null)
    .order('starts_at')
  if (error) throw new Error(error.message)

  const nu = new Date()
  const items: BelItem[] = ((data ?? []) as unknown as Rij[])
    // Geannuleerd of al afgerond hoeft niet gebeld te worden.
    .filter((r) => r.status === 'scheduled')
    .map((r) => {
      const c = r.sales_contacts
      const bedrijf = r.sales_leads?.sales_companies ?? null
      const dagenTot = dagVerschil(r.starts_at, nu)
      return {
        appointmentId: r.id,
        startsAt: r.starts_at,
        bedrijf: bedrijf?.name ?? null,
        contact: c?.name ?? null,
        // Mobiel eerst: daarmee bereik je iemand, een centrale nummer niet.
        telefoon: c?.mobile || c?.phone || bedrijf?.phone || null,
        mobiel: c?.mobile ?? null,
        email: c?.email || r.attendee_email || null,
        pipeline: r.pipeline_id ?? null,
        agenda: null,
        notitie: r.notes ?? null,
        leadId: r.lead_id ?? null,
        dagenTot,
        teLaat: dagenTot >= 0 && dagenTot < dagenVooraf,
      }
    })
    .filter((i) => i.dagenTot >= 0)

  return {
    tebellen: items.filter((i) => moetGebeldWorden(i.dagenTot, dagenVooraf)),
    later: items.filter((i) => !moetGebeldWorden(i.dagenTot, dagenVooraf)),
  }
}

/** Bevestigd: het gesprek is gevoerd. Verdwijnt daarmee uit de bellijst. */
export async function markeerGebeld(
  appointmentId: string, actorId: string | null, notitie?: string | null,
): Promise<void> {
  const admin = createAdminSupabaseClient()
  const { error } = await admin.from('sales_appointments').update({
    bevestigd_op: new Date().toISOString(),
    bevestigd_door: actorId,
    bevestig_notitie: notitie?.trim() || null,
  }).eq('id', appointmentId)
  if (error) throw new Error(error.message)
}

/** Toch niet gebeld — terug op de lijst. */
export async function maakOngedaan(appointmentId: string): Promise<void> {
  const admin = createAdminSupabaseClient()
  const { error } = await admin.from('sales_appointments').update({
    bevestigd_op: null, bevestigd_door: null, bevestig_notitie: null,
  }).eq('id', appointmentId)
  if (error) throw new Error(error.message)
}
