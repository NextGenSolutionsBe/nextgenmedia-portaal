import 'server-only'
import { createHash, randomBytes } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { dag, plusDagen, TZ, type Item } from './model'
import { keren, reeksItems, reeksItemId, blokIntervallen, type Reeks } from './reeksen'
import type { Beschikbaarheid, Bezet } from './team'
import type { Kijker, Zicht } from './server'

type Admin = SupabaseClient

/**
 * Teamagenda op de server (verbeterplan fase 3): reeksen in de kalender, "Bezet",
 * beschikbaarheid en iCal-links. Zichtbaarheid zoals overal in de agenda (laadZicht):
 * een reeks zie je als je erop staat, ze maakte, of ze niet privé is (en je de lijst ziet).
 * Een privé reeks van iemand anders wordt in de teamweergave enkel "Bezet".
 */

const REEKS_VELDEN = 'id, soort, blok_type, titel, kleur, personen, lijst_id, prive, dagen, interval_weken, van, tot, start_datum, eind_datum, uitzonderingen, eigenaar_id'

export function reeksZichtbaar(r: Pick<Reeks, 'personen' | 'eigenaar_id' | 'prive' | 'lijst_id'>, z: Zicht): boolean {
  if (r.personen.includes(z.ik) || r.eigenaar_id === z.ik) return true
  if (r.prive && !(r.eigenaar_id && z.gedeeldMet.has(r.eigenaar_id))) return false
  if (r.lijst_id) return z.zichtbaar.lijsten.has(r.lijst_id)
  return true
}

const naarReeks = (r: Record<string, unknown>): Reeks => ({
  ...(r as unknown as Reeks),
  personen: (r.personen as string[] | null) ?? [], dagen: ((r.dagen as number[] | null) ?? []).map(Number),
  uitzonderingen: ((r.uitzonderingen as string[] | null) ?? []).map(String), interval_weken: Number(r.interval_weken) || 1,
})

/** Alle lopende reeksen die een periode raken (ruw, zonder te filteren op zicht). Leeg als de tabel nog niet bestaat. */
export async function laadReeksen(admin: Admin, vanDag: string, totDag: string): Promise<Reeks[]> {
  const { data, error } = await admin.from('ag_reeksen').select(REEKS_VELDEN).is('verwijderd_op', null)
    .lte('start_datum', totDag).or(`eind_datum.is.null,eind_datum.gte.${vanDag}`).limit(500)
  if (error) return []
  return ((data ?? []) as Record<string, unknown>[]).map(naarReeks)
}

/** De keren van de reeksen als items (wat je ziet) en, voor de teamweergave, de privé blokken van anderen als Bezet. */
export async function reeksenInBereik(admin: Admin, z: Zicht, vanIso: string, totIso: string, bezet?: Bezet[]): Promise<Item[]> {
  const vanDag = dag(vanIso, TZ), totDag = dag(new Date(Date.parse(totIso) - 1).toISOString(), TZ)
  const reeksen = await laadReeksen(admin, vanDag, totDag)
  if (!reeksen.length) return []
  // Een keer die al een eigen item werd (afgevinkt, aangepast of verwijderd), toont de reeks niet meer.
  const { data: eigen } = await admin.from('ag_items').select('reeks_id, reeks_datum').in('reeks_id', reeksen.map((r) => r.id)).gte('reeks_datum', vanDag).lte('reeks_datum', totDag)
  const al = new Map<string, Set<string>>()
  for (const e of (eigen ?? []) as { reeks_id: string; reeks_datum: string }[]) al.set(e.reeks_id, new Set([...(al.get(e.reeks_id) ?? []), e.reeks_datum]))
  const uit: Item[] = []
  for (const r of reeksen) {
    if (reeksZichtbaar(r, z)) { uit.push(...reeksItems(r, vanDag, totDag, al.get(r.id))); continue }
    if (bezet && r.soort !== 'taak') for (const i of reeksItems(r, vanDag, totDag, al.get(r.id))) if (!i.heel_dag && i.start_op && i.eind_op) bezet.push({ start_op: i.start_op, eind_op: i.eind_op, personen: r.personen })
  }
  return uit
}

/** Eén reeks, enkel als je ze mag aanpassen (je staat erop, maakte ze, of bent zaakvoerder). */
export async function eigenReeks(admin: Admin, k: Kijker, id: unknown): Promise<Reeks> {
  if (typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Onbekende reeks')
  const { data } = await admin.from('ag_reeksen').select(REEKS_VELDEN).eq('id', id).is('verwijderd_op', null).maybeSingle()
  if (!data) throw new Error('Deze reeks bestaat niet meer.')
  const r = naarReeks(data as Record<string, unknown>)
  if (!k.isAdmin && r.eigenaar_id !== k.persoonId && !r.personen.includes(k.persoonId)) throw new Error('Enkel wie op de reeks staat, kan ze aanpassen.')
  return r
}

/** Een keer van een herhalende taak wordt een gewoon item (afvinken of openen). Twee klikken = één item. */
export async function keerAlsItem(admin: Admin, k: Kijker, r: Reeks, datum: string, klaar: boolean): Promise<string> {
  if (!keren(r, datum, datum).length) throw new Error('Op die dag valt de reeks niet.')
  const { data: al } = await admin.from('ag_items').select('id').eq('reeks_id', r.id).eq('reeks_datum', datum).maybeSingle()
  if (al) {
    if (klaar) await admin.from('ag_items').update({ status: 'klaar', afgerond_op: new Date().toISOString(), afgerond_door: k.naam, in_app_gewijzigd_op: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', (al as { id: string }).id)
    return (al as { id: string }).id
  }
  const [i] = reeksItems(r, datum, datum)
  const nu = new Date().toISOString()
  const { data, error } = await admin.from('ag_items').insert({
    soort: i.soort, titel: r.titel, status: klaar ? 'klaar' : 'open', afgerond_op: klaar ? nu : null, afgerond_door: klaar ? k.naam : null,
    start_op: i.start_op, eind_op: i.eind_op, heel_dag: i.heel_dag, lijst_id: r.lijst_id, kleur: r.kleur, prive: r.prive, labels: [],
    eigenaar_id: r.eigenaar_id ?? k.persoonId, gemaakt_door: k.naam, in_app_gewijzigd_op: nu, reeks_id: r.id, reeks_datum: datum,
  }).select('id').single()
  if (error || !data) {
    // Tegelijk aangeklikt: de unieke index weigert de tweede, dan nemen we die van de eerste.
    const { data: nog } = await admin.from('ag_items').select('id').eq('reeks_id', r.id).eq('reeks_datum', datum).maybeSingle()
    if (nog) return (nog as { id: string }).id
    throw new Error(error?.message ?? 'Bewaren mislukt')
  }
  const id = (data as { id: string }).id
  const { data: geldig } = r.personen.length ? await admin.from('ag_personen').select('id').in('id', r.personen) : { data: [] }
  const ids = ((geldig ?? []) as { id: string }[]).map((p) => p.id)
  if (ids.length) await admin.from('ag_toegewezen').insert(ids.map((p) => ({ item_id: id, persoon_id: p })))
  return id
}

export { reeksItemId }

export async function laadBeschikbaarheid(admin: Admin): Promise<Beschikbaarheid[]> {
  const { data, error } = await admin.from('ag_beschikbaarheid').select('persoon_id, weekdag, van, tot')
  if (error) return []
  return (data ?? []) as Beschikbaarheid[]
}

// ── iCal ────────────────────────────────────────────────────────────────────

export const icalHash = (token: string) => createHash('sha256').update(token).digest('hex')

/** Een nieuwe link (de oude van dezelfde soort wordt ingetrokken). Het token zelf bewaren we nooit. */
export async function nieuweIcalLink(admin: Admin, persoonId: string, team: boolean): Promise<string> {
  const token = randomBytes(24).toString('base64url')
  await admin.from('ag_ical_links').update({ ingetrokken_op: new Date().toISOString() }).eq('persoon_id', persoonId).eq('team', team).is('ingetrokken_op', null)
  const { error } = await admin.from('ag_ical_links').insert({ persoon_id: persoonId, team, token_hash: icalHash(token) })
  if (error) throw new Error(error.message)
  return token
}

export async function trekIcalIn(admin: Admin, persoonId: string, team: boolean): Promise<void> {
  await admin.from('ag_ical_links').update({ ingetrokken_op: new Date().toISOString() }).eq('persoon_id', persoonId).eq('team', team).is('ingetrokken_op', null)
}

export async function icalLinksVan(admin: Admin, persoonId: string): Promise<{ team: boolean; created_at: string; laatst_gebruikt_op: string | null }[]> {
  const { data } = await admin.from('ag_ical_links').select('team, created_at, laatst_gebruikt_op').eq('persoon_id', persoonId).is('ingetrokken_op', null)
  return (data ?? []) as { team: boolean; created_at: string; laatst_gebruikt_op: string | null }[]
}

/** Van wie is deze link? Null als hij niet (meer) bestaat. */
export async function icalVanToken(admin: Admin, token: string): Promise<{ persoonId: string; team: boolean } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null
  const { data } = await admin.from('ag_ical_links').select('id, persoon_id, team').eq('token_hash', icalHash(token)).is('ingetrokken_op', null).maybeSingle()
  if (!data) return null
  const l = data as { id: string; persoon_id: string; team: boolean }
  await admin.from('ag_ical_links').update({ laatst_gebruikt_op: new Date().toISOString() }).eq('id', l.id)
  return { persoonId: l.persoon_id, team: l.team }
}

/** Van vandaag 30 dagen terug tot 120 dagen vooruit: genoeg voor een agenda-abonnement. */
export const icalPeriode = (nu = new Date()) => {
  const v = dag(nu.toISOString(), TZ)
  return { van: plusDagen(v, -30), tot: plusDagen(v, 120) }
}

/**
 * Vaste blokken van de persoon achter een agenda (via de ClickUp-persoon van die agenda) voor de
 * Meeting Inplanner: klantboekingen kunnen er niet in, intern geeft het een waarschuwing.
 * Lukt het lezen niet, dan geen blokken (de rest van de planner blijft werken).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function vasteBlokkenVoor(admin: any, clickupId: string | number | null | undefined, vanMs: number, totMs: number): Promise<{ start: number; end: number; titel: string }[]> {
  if (clickupId === null || clickupId === undefined || clickupId === '') return []
  try {
    const { data: p } = await admin.from('ag_personen').select('id').eq('clickup_id', String(clickupId)).maybeSingle()
    if (!p) return []
    const van = new Date(vanMs - 86_400_000).toISOString().slice(0, 10), tot = new Date(totMs + 86_400_000).toISOString().slice(0, 10)
    return blokIntervallen(await laadReeksen(admin as Admin, van, tot), (p as { id: string }).id, vanMs, totMs)
  } catch { return [] }
}
