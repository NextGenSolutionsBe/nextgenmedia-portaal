import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Space, Map as AgMap, Lijst, DocKort, Item, Label, Persoon } from '@/lib/agenda/model'
import { persoonVanGebruiker } from '@/lib/agenda/personen-server'

type Admin = SupabaseClient

/**
 * Wie ziet wat in de agenda.
 *  · Een space, map of lijst zonder leden ziet iedereen met toegang tot de agenda.
 *  · Met leden (privé in ClickUp, bv. "Zaakvoerders" of "Marco Privé") enkel die leden.
 *  · Met precies één lid is het iemands eigen agenda: die kan ze delen met
 *    collega's (ag_delen), dan zien zij ze ook.
 *  · Een privé-item zien de eigenaar, wie erop staat en wie de eigenaar het deelde.
 *  · Wie op een item staat of het maakte, ziet het altijd.
 * Admins krijgen hier geen uitzondering: privé blijft privé.
 */

export type Kijker = { persoonId: string; userId: string; naam: string; isAdmin: boolean }

export type Zicht = {
  ik: string
  gedeeldMet: Set<string> // eigenaars die hun agenda met mij delen
  spaces: Space[]; mappen: AgMap[]; lijsten: Lijst[]
  leden: Map<string, string[]> // `${soort}:${id}` → personen
  zichtbaar: { spaces: Set<string>; mappen: Set<string>; lijsten: Set<string> }
}

export async function kijkerVan(admin: Admin, p: { userId: string; naam: string | null; email: string; isAdmin: boolean }): Promise<Kijker | null> {
  const persoon = await persoonVanGebruiker(admin, p.userId)
  if (!persoon) return null
  return { persoonId: persoon.id, userId: p.userId, naam: persoon.naam || p.naam || p.email, isAdmin: p.isAdmin }
}

const SPACE_VELDEN = 'id, naam, kleur, prive, volgorde, clickup_id'
const MAP_VELDEN = 'id, space_id, parent_id, naam, kleur, client_id, prive, volgorde, clickup_id'
const LIJST_VELDEN = 'id, space_id, map_id, naam, kleur, client_id, prive, volgorde, clickup_id, statussen'

/** Met `metVerwijderd` ook wat in de prullenbak zit (met verwijderd_op), om terug te zetten. */
export async function laadZicht(admin: Admin, k: Kijker, opts: { metVerwijderd?: boolean } = {}): Promise<Zicht> {
  const extra = opts.metVerwijderd ? ', verwijderd_op, verwijderd_door' : ''
  const actief = <Q extends { is: (k: string, v: null) => Q }>(q: Q) => (opts.metVerwijderd ? q : q.is('verwijderd_op', null))
  const [sp, mp, lj, ld, dl] = await Promise.all([
    actief(admin.from('ag_spaces').select(SPACE_VELDEN + extra)).order('volgorde'),
    actief(admin.from('ag_mappen').select(MAP_VELDEN + extra)).order('volgorde'),
    actief(admin.from('ag_lijsten').select(LIJST_VELDEN + extra)).order('volgorde'),
    admin.from('ag_leden').select('soort, doel_id, persoon_id'),
    admin.from('ag_delen').select('eigenaar_id').eq('kijker_id', k.persoonId),
  ])
  const leden = new Map<string, string[]>()
  for (const r of (ld.data ?? []) as { soort: string; doel_id: string; persoon_id: string }[]) {
    const s = `${r.soort}:${r.doel_id}`
    leden.set(s, [...(leden.get(s) ?? []), r.persoon_id])
  }
  const gedeeldMet = new Set(((dl.data ?? []) as { eigenaar_id: string }[]).map((x) => x.eigenaar_id))
  const z: Zicht = {
    ik: k.persoonId, gedeeldMet, leden,
    spaces: (sp.data ?? []) as unknown as Space[], mappen: (mp.data ?? []) as unknown as AgMap[], lijsten: (lj.data ?? []) as unknown as Lijst[],
    zichtbaar: { spaces: new Set(), mappen: new Set(), lijsten: new Set() },
  }
  const mag = (soort: string, id: string) => {
    const l = leden.get(`${soort}:${id}`) ?? []
    return !l.length || l.includes(k.persoonId) || (l.length === 1 && gedeeldMet.has(l[0]))
  }
  for (const s of z.spaces) if (mag('space', s.id)) z.zichtbaar.spaces.add(s.id)
  const mapPer = new Map(z.mappen.map((m) => [m.id, m]))
  const mapOk = (id: string, diepte = 0): boolean => {
    const m = mapPer.get(id)
    if (!m || diepte > 6 || !z.zichtbaar.spaces.has(m.space_id) || !mag('map', m.id)) return false
    return m.parent_id ? mapOk(m.parent_id, diepte + 1) : true
  }
  for (const m of z.mappen) if (mapOk(m.id)) z.zichtbaar.mappen.add(m.id)
  for (const l of z.lijsten) if (z.zichtbaar.spaces.has(l.space_id) && (!l.map_id || z.zichtbaar.mappen.has(l.map_id)) && mag('lijst', l.id)) z.zichtbaar.lijsten.add(l.id)
  return z
}

/** Wie (persoon) heeft deze container voor zichzelf? (één lid = iemands eigen agenda) */
export function eigenaarVan(z: Zicht, soort: 'space' | 'map' | 'lijst', id: string): string | null {
  const l = z.leden.get(`${soort}:${id}`) ?? []
  return l.length === 1 ? l[0] : null
}

export type RuwItem = Omit<Item, 'bron' | 'toegewezen' | 'subtaken'> & { clickup_id: string | null; clickup_lijst_id: string | null; verwijderd_op?: string | null }

export function itemZichtbaar(i: Pick<RuwItem, 'lijst_id' | 'clickup_lijst_id' | 'prive' | 'eigenaar_id'>, toegewezen: string[], z: Zicht): boolean {
  if (toegewezen.includes(z.ik) || i.eigenaar_id === z.ik) return true
  if (i.prive && !(i.eigenaar_id && z.gedeeldMet.has(i.eigenaar_id))) return false
  if (i.lijst_id) return z.zichtbaar.lijsten.has(i.lijst_id)
  if (i.clickup_lijst_id) return false // lijst (nog) niet gekend: liever niet tonen
  return true
}

export function docZichtbaar(d: { space_id: string | null; map_id: string | null; lijst_id: string | null; prive: boolean; eigenaar_id: string | null; clickup_parent_id?: string | null; kijkers?: string[] | null }, z: Zicht): boolean {
  if (d.eigenaar_id === z.ik) return true
  // Privé: de eigenaar, wie in het doc zelf toegevoegd werd, en wie de eigenaar zijn agenda deelde.
  if (d.prive) return !!d.kijkers?.includes(z.ik) || (!!d.eigenaar_id && z.gedeeldMet.has(d.eigenaar_id))
  if (d.lijst_id) return z.zichtbaar.lijsten.has(d.lijst_id)
  if (d.map_id) return z.zichtbaar.mappen.has(d.map_id)
  if (d.space_id) return z.zichtbaar.spaces.has(d.space_id)
  return !d.clickup_parent_id
}

export const ITEM_VELDEN = 'id, soort, titel, status, clickup_status, clickup_status_kleur, urgent, prioriteit, start_op, eind_op, heel_dag, lijst_id, parent_id, client_id, labels, kleur, locatie, meet_url, prive, eigenaar_id, afgerond_op, afgerond_door, clickup_url, clickup_id, clickup_lijst_id, updated_at'

/** Items met hun toegewezenen en het aantal subtaken, enkel wat de kijker mag zien. */
export async function metToegewezen(admin: Admin, ruw: RuwItem[], z: Zicht, opts: { subtaken?: boolean } = {}): Promise<Item[]> {
  if (!ruw.length) return []
  const ids = ruw.map((r) => r.id)
  // Per 150 id's (de lijst gaat in de adresregel) en alle stukken tegelijk.
  const stukken: string[][] = []
  for (let i = 0; i < ids.length; i += 150) stukken.push(ids.slice(i, i + 150))
  const [twRijen, subRijen] = await Promise.all([
    Promise.all(stukken.map((s) => admin.from('ag_toegewezen').select('item_id, persoon_id').in('item_id', s).then((r) => (r.data ?? []) as { item_id: string; persoon_id: string }[]))),
    opts.subtaken ? Promise.all(stukken.map((s) => admin.from('ag_items').select('parent_id').in('parent_id', s).is('verwijderd_op', null).then((r) => (r.data ?? []) as { parent_id: string }[]))) : Promise.resolve([]),
  ])
  const tw = new Map<string, string[]>()
  for (const r of twRijen.flat()) tw.set(r.item_id, [...(tw.get(r.item_id) ?? []), r.persoon_id])
  const sub = new Map<string, number>()
  for (const r of subRijen.flat()) sub.set(r.parent_id, (sub.get(r.parent_id) ?? 0) + 1)
  return ruw
    .filter((r) => itemZichtbaar(r, tw.get(r.id) ?? [], z))
    .map((r) => {
      const { clickup_id: _c, clickup_lijst_id: _l, verwijderd_op: _v, ...rest } = r
      void _c; void _l; void _v
      return { ...rest, bron: 'ag' as const, beschrijving: (r as { beschrijving?: string | null }).beschrijving ?? null, velden: (r as { velden?: Record<string, unknown> | null }).velden ?? null, labels: r.labels ?? [], toegewezen: tw.get(r.id) ?? [], ...(opts.subtaken ? { subtaken: sub.get(r.id) ?? 0 } : {}) }
    })
}

/** Meetings uit de Meeting Inplanner in dezelfde vorm (enkel voor wie de module Meetings mag zien). */
export async function meetingsInBereik(admin: Admin, van: string, tot: string, persoonVoorEmail: Map<string, string>): Promise<{ items: Item[]; clickupIds: Set<string> }> {
  const { data } = await admin.from('klant_meetings')
    .select('id, titel, beschrijving, starts_at, ends_at, status, client_id, klant_naam, meet_url, locatie, vorm, organisator_email, clickup_task_id, bron, updated_at, deelnemers')
    .lt('starts_at', tot).gt('ends_at', van).neq('status', 'geannuleerd').limit(1000)
  const clickupIds = new Set<string>()
  const items: Item[] = []
  for (const m of (data ?? []) as { id: string; titel: string | null; beschrijving: string | null; starts_at: string; ends_at: string; status: string; client_id: string | null; klant_naam: string | null; meet_url: string | null; locatie: string | null; vorm: string | null; organisator_email: string | null; clickup_task_id: string | null; bron: string | null; updated_at: string; deelnemers: unknown }[]) {
    if (m.clickup_task_id) clickupIds.add(m.clickup_task_id)
    const toegewezen: string[] = []
    const org = m.organisator_email ? persoonVoorEmail.get(m.organisator_email.toLowerCase()) : null
    if (org) toegewezen.push(org)
    for (const d of Array.isArray(m.deelnemers) ? m.deelnemers as { email?: string }[] : []) {
      const p = d?.email ? persoonVoorEmail.get(String(d.email).toLowerCase()) : null
      if (p && !toegewezen.includes(p)) toegewezen.push(p)
    }
    items.push({
      id: m.id, bron: 'meeting', soort: 'meeting', titel: m.titel || (m.klant_naam ? `Meeting ${m.klant_naam}` : 'Meeting'), beschrijving: m.beschrijving,
      status: Date.parse(m.ends_at) < Date.now() ? 'klaar' : 'open', clickup_status: null, clickup_status_kleur: null, urgent: false, prioriteit: null,
      start_op: m.starts_at, eind_op: m.ends_at, heel_dag: false, lijst_id: null, parent_id: null, client_id: m.client_id, labels: [], kleur: null,
      locatie: m.vorm === 'locatie' ? m.locatie : null, meet_url: m.meet_url, prive: false, eigenaar_id: null, toegewezen, afgerond_op: null, afgerond_door: null,
      clickup_url: null, velden: m.bron === 'klantboeking' ? { Bron: 'Klantboeking' } : null, updated_at: m.updated_at,
    })
  }
  return { items, clickupIds }
}

export type BoomAntwoord = {
  spaces: Space[]; mappen: AgMap[]; lijsten: Lijst[]; docs: DocKort[]
  leden: Record<string, string[]>
}

/** De boom zoals de kijker hem mag zien (met de docs, zonder inhoud). */
export async function boomVoor(admin: Admin, z: Zicht): Promise<BoomAntwoord> {
  const { data: docs } = await admin.from('ag_docs').select('id, titel, space_id, map_id, lijst_id, prive, eigenaar_id, kijkers, clickup_parent_id, updated_at').is('verwijderd_op', null).order('titel').limit(5000)
  const leden: Record<string, string[]> = {}
  for (const [k, v] of z.leden) {
    const [soort, id] = k.split(':')
    if ((soort === 'space' && z.zichtbaar.spaces.has(id)) || (soort === 'map' && z.zichtbaar.mappen.has(id)) || (soort === 'lijst' && z.zichtbaar.lijsten.has(id))) leden[k] = v
  }
  return {
    spaces: z.spaces.filter((s) => z.zichtbaar.spaces.has(s.id)),
    mappen: z.mappen.filter((m) => z.zichtbaar.mappen.has(m.id)),
    lijsten: z.lijsten.filter((l) => z.zichtbaar.lijsten.has(l.id)),
    docs: ((docs ?? []) as (DocKort & { eigenaar_id: string | null; clickup_parent_id: string | null; kijkers: string[] | null })[])
      .filter((d) => docZichtbaar(d, z))
      .map(({ eigenaar_id: _e, clickup_parent_id: _c, kijkers: _k, ...d }) => { void _e; void _c; void _k; return d }),
    leden,
  }
}

export async function laadPersonen(admin: Admin): Promise<Persoon[]> {
  const { data } = await admin.from('ag_personen').select('id, user_id, naam, email, kleur, actief').order('naam')
  return ((data ?? []) as Persoon[])
}

export async function laadLabels(admin: Admin): Promise<Label[]> {
  const { data } = await admin.from('ag_labels').select('id, naam, kleur, volgorde').order('volgorde').order('naam')
  return (data ?? []) as Label[]
}

/** Alle rijen van een vraag, per 1000 (de databank geeft er nooit meer per keer). */
export async function alleRijen<T>(maak: (van: number, tot: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>, max = 20_000): Promise<T[]> {
  const uit: T[] = []
  for (let van = 0; van < max; van += 1000) {
    const { data, error } = await maak(van, van + 999)
    if (error) throw new Error(error.message)
    uit.push(...((data ?? []) as T[]))
    if (!data || data.length < 1000) break
  }
  return uit
}

/** Alle items die een periode raken (met begin en einde, enkel een einde, of enkel een begin). */
export async function itemsInBereik(admin: Admin, van: string, tot: string, extra = ''): Promise<RuwItem[]> {
  const V = `"${new Date(van).toISOString()}"`, T = `"${new Date(tot).toISOString()}"`
  return alleRijen<RuwItem>((a, b) => admin.from('ag_items').select(ITEM_VELDEN + extra).is('verwijderd_op', null)
    .or(`and(eind_op.gte.${V},start_op.lt.${T}),and(start_op.is.null,eind_op.gte.${V},eind_op.lt.${T}),and(eind_op.is.null,start_op.gte.${V},start_op.lt.${T})`)
    .order('id').range(a, b))
}
