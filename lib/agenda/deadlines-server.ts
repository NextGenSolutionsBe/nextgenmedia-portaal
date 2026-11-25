import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { vandaag, plusDagen, zoneNaarIso, deadlineLabel, TZ, uur } from '@/lib/agenda/model'
import { persoonVanGebruiker } from '@/lib/agenda/personen-server'
import type { Notif } from '@/lib/notifications'

type Admin = SupabaseClient

/**
 * Jouw deadlines: open taken met een deadline vandaag, of de voorbije week
 * en nog niet af. "Jouw" = je staat erop, of niemand staat erop en jij maakte
 * ze. Wie op een taak staat, ziet ze altijd (zelfde regel als de agenda), dus
 * hier is geen verdere zichtbaarheidscontrole nodig.
 */
export type MijnDeadline = {
  id: string; titel: string; deadline_op: string; urgent: boolean; status: 'open' | 'klaar'
  pad: string; samenMet: string[]; teLaat: boolean; vandaag: boolean
}

export async function mijnDeadlines(admin: Admin, userId: string, nu: Date = new Date()): Promise<MijnDeadline[]> {
  const persoon = await persoonVanGebruiker(admin, userId)
  if (!persoon) return []
  const v = vandaag(nu)
  const van = zoneNaarIso(plusDagen(v, -7), '00:00'), tot = zoneNaarIso(plusDagen(v, 1), '00:00')
  const { data } = await admin.from('ag_items').select('id, titel, deadline_op, urgent, status, lijst_id, eigenaar_id')
    .is('verwijderd_op', null).eq('status', 'open').gte('deadline_op', van).lt('deadline_op', tot)
    .order('deadline_op').limit(300)
  const rijen = (data ?? []) as { id: string; titel: string; deadline_op: string; urgent: boolean; status: 'open'; lijst_id: string | null; eigenaar_id: string | null }[]
  if (!rijen.length) return []
  const { data: tw } = await admin.from('ag_toegewezen').select('item_id, persoon_id').in('item_id', rijen.map((r) => r.id))
  const per = new Map<string, string[]>()
  for (const t of (tw ?? []) as { item_id: string; persoon_id: string }[]) per.set(t.item_id, [...(per.get(t.item_id) ?? []), t.persoon_id])
  const mijn = rijen.filter((r) => { const w = per.get(r.id) ?? []; return w.includes(persoon.id) || (!w.length && r.eigenaar_id === persoon.id) })
  if (!mijn.length) return []
  const lijstIds = [...new Set(mijn.map((r) => r.lijst_id).filter(Boolean))] as string[]
  const andereIds = [...new Set(mijn.flatMap((r) => per.get(r.id) ?? []).filter((p) => p !== persoon.id))]
  const [lj, pers] = await Promise.all([
    lijstIds.length ? admin.from('ag_lijsten').select('id, naam, map_id').in('id', lijstIds) : Promise.resolve({ data: [] }),
    andereIds.length ? admin.from('ag_personen').select('id, naam').in('id', andereIds) : Promise.resolve({ data: [] }),
  ])
  const lijsten = (lj.data ?? []) as { id: string; naam: string; map_id: string | null }[]
  const mapIds = [...new Set(lijsten.map((l) => l.map_id).filter(Boolean))] as string[]
  const { data: mp } = mapIds.length ? await admin.from('ag_mappen').select('id, naam').in('id', mapIds) : { data: [] }
  const mapNaam = new Map(((mp ?? []) as { id: string; naam: string }[]).map((m) => [m.id, m.naam]))
  const lijstPer = new Map(lijsten.map((l) => [l.id, l]))
  const naam = new Map(((pers.data ?? []) as { id: string; naam: string }[]).map((p) => [p.id, p.naam.split(' ')[0]]))
  return mijn.map((r) => {
    const l = r.lijst_id ? lijstPer.get(r.lijst_id) : null
    const label = deadlineLabel(r.deadline_op, undefined, nu)
    return {
      id: r.id, titel: r.titel, deadline_op: r.deadline_op, urgent: r.urgent, status: r.status,
      pad: l ? [l.map_id ? mapNaam.get(l.map_id) : null, l.naam].filter(Boolean).join(' › ') : '',
      samenMet: (per.get(r.id) ?? []).filter((p) => p !== persoon.id).map((p) => naam.get(p) ?? '').filter(Boolean),
      teLaat: label.teLaat, vandaag: label.vandaag,
    }
  })
}

/** Voor het belletje: elke deadline van vandaag, en wat de voorbije week niet af raakte. */
export async function deadlineMeldingenVoor(admin: Admin, userId: string): Promise<Notif[]> {
  const lijst = await mijnDeadlines(admin, userId)
  const nu = Date.now()
  return lijst.map((d) => {
    const binnenkort = Date.parse(d.deadline_op) - nu < 2 * 3600_000
    const wanneer = d.vandaag ? `vandaag ${uur(d.deadline_op, TZ)}` : deadlineLabel(d.deadline_op).tekst.replace(/^Deadline /, '')
    return {
      id: `agenda-deadline:${d.id}:${d.deadline_op}`, kind: 'agenda',
      priority: d.teLaat || binnenkort ? 'high' : 'med',
      title: d.teLaat ? `Deadline voorbij (${wanneer}): ${d.titel}` : `Deadline ${wanneer}: ${d.titel}`,
      date: d.deadline_op.slice(0, 10), href: `/admin/agenda?item=${d.id}`,
    } satisfies Notif
  })
}
