import 'server-only'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { kwartalen, shootsTeLaat, cyclusVoorMaand, maandPlus, type Maand, type CyclusTaak } from './kwartaal'

/**
 * Kwartaalcyclus op de server (nieuwe werking fase 7). Een shoot "ligt vast" als
 * er in die maand een shoot van de klant in de Shoot planner staat (niet
 * geannuleerd), of als iemand het met de hand afvinkte (`media_kwartaal_shoots`).
 */
type Admin = ReturnType<typeof createAdminSupabaseClient>
const vandaag = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())

export type KwartaalKlant = { id: string; naam: string; media_start: string; media_start_bron: string | null }

async function vastgelegdPerKlant(admin: Admin, ids: string[], van: string): Promise<Map<string, Set<Maand>>> {
  const uit = new Map<string, Set<Maand>>()
  if (!ids.length) return uit
  const [{ data: s }, { data: h }] = await Promise.all([
    admin.from('shoot_briefings').select('client_id, shoot_date, status').in('client_id', ids).gte('shoot_date', van),
    admin.from('media_kwartaal_shoots').select('client_id, shoot_maand').in('client_id', ids),
  ])
  const zet = (id: string, m: Maand) => { const x = uit.get(id) ?? new Set<Maand>(); x.add(m); uit.set(id, x) }
  for (const r of (s ?? []) as { client_id: string; shoot_date: string | null; status: string | null }[]) if (r.shoot_date && r.status !== 'geannuleerd') zet(r.client_id, r.shoot_date.slice(0, 7))
  for (const r of (h ?? []) as { client_id: string; shoot_maand: string }[]) zet(r.client_id, r.shoot_maand)
  return uit
}

async function mediaKlanten(admin: Admin): Promise<KwartaalKlant[]> {
  const { data } = await admin.from('clients').select('id, company_name, media_start, media_start_bron').not('media_start', 'is', null).limit(1000)
  return ((data ?? []) as { id: string; company_name: string; media_start: string; media_start_bron: string | null }[]).map((c) => ({ id: c.id, naam: c.company_name, media_start: c.media_start, media_start_bron: c.media_start_bron }))
}

/** Op te volgen: shoots van het volgende kwartaal die op de eerste van de maand nog niet vastliggen. */
export async function kwartaalShootsTeLaat(admin: Admin): Promise<{ client_id: string; klant: string; kwartaal: number; shootMaand: Maand; tegen: string }[]> {
  const klanten = await mediaKlanten(admin)
  const d = vandaag()
  const vast = await vastgelegdPerKlant(admin, klanten.map((k) => k.id), `${maandPlus(d.slice(0, 7), -2)}-01`)
  return klanten.flatMap((k) => shootsTeLaat(k.media_start, d, vast.get(k.id) ?? new Set()).map((q) => ({ client_id: k.id, klant: k.naam, kwartaal: q.nr, shootMaand: q.shootMaand, tegen: q.vastleggenTegen })))
}

/** Planning Media: per klant wat er deze maand in de cyclus staat, met of de shoot al vastligt. */
export async function kwartaalVoorMaand(admin: Admin, maand: Maand): Promise<{ klant: KwartaalKlant; taken: (CyclusTaak & { vast?: boolean })[] }[]> {
  const klanten = await mediaKlanten(admin)
  const vast = await vastgelegdPerKlant(admin, klanten.map((k) => k.id), `${maandPlus(maand, -2)}-01`)
  return klanten.map((k) => ({
    klant: k,
    taken: cyclusVoorMaand(k.media_start, maand).map((t) => (t.soort === 'vastleggen' ? { ...t, vast: vast.get(k.id)?.has(maand) ?? false } : t)),
  })).filter((x) => x.taken.length)
}

/** Een shoot met de hand als vastgelegd aanduiden (of terug). */
export async function zetShootVast(admin: Admin, clientId: string, maand: Maand, vast: boolean, door: string | null): Promise<void> {
  if (!/^\d{4}-\d{2}$/.test(maand)) throw new Error('Onbekende maand.')
  if (vast) {
    const { error } = await admin.from('media_kwartaal_shoots').upsert({ client_id: clientId, shoot_maand: maand, door }, { onConflict: 'client_id,shoot_maand' })
    if (error) throw new Error(error.message)
  } else {
    // Enkel het handmatige vinkje gaat weg; een shoot in de planner blijft gewoon staan.
    const { error } = await admin.from('media_kwartaal_shoots').delete().eq('client_id', clientId).eq('shoot_maand', maand)
    if (error) throw new Error(error.message)
  }
}

/** Klanten met social media maar zonder startdatum voor de cyclus: de lijst om na te kijken. */
export async function zonderStart(admin: Admin, socialKlantIds: string[]): Promise<{ id: string; naam: string }[]> {
  if (!socialKlantIds.length) return []
  const { data } = await admin.from('clients').select('id, company_name').in('id', socialKlantIds).is('media_start', null)
  return ((data ?? []) as { id: string; company_name: string }[]).map((c) => ({ id: c.id, naam: c.company_name }))
}

export { kwartalen }
