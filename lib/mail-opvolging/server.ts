import 'server-only'
import { kolomVan } from '@/lib/opdrachten-kanban'
import { mailboxen } from './mailboxen'
import { bepaalOpvolging, type AiSoort, type Gebeurtenis, type Opvolging } from './regels'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export type Project = { id: string; client_id: string | null; lead_id: string | null; contract_id: string | null; status: string; kolom: string; updated_at: string; titel: string; klant: string | null; diensten: string[] }
export type ProjectOpvolging = { project: Project; opvolging: Opvolging | null; gebeurtenissen: Gebeurtenis[] }

const ACTIEF = new Set(['potentieel', 'offerte', 'geaccepteerd', 'contract'])
const TERUG_DAGEN = 120

/**
 * De opvolging van lopende projecten (Opvolging, Offerte, Offerte geaccepteerd,
 * Contract verstuurd), uit wat er in de app staat: meetings (Meeting Inplanner,
 * verkoopafspraken, Google-agenda), verstuurde offertes en contracten, en de
 * gelezen mails. Een mail die enkel aan een klant hangt, telt voor het lopende
 * project van die klant (het recentst bijgewerkte).
 */
export async function laadOpvolgingen(admin: Admin, opts: { opdrachtId?: string; nu?: Date } = {}): Promise<ProjectOpvolging[]> {
  const nu = opts.nu ?? new Date()
  const sinds = new Date(nu.getTime() - TERUG_DAGEN * 86_400_000).toISOString()
  let q = admin.from('opdrachten').select('id, client_id, lead_id, contract_id, status, updated_at, titel, klant_vrij, diensten')
  if (opts.opdrachtId) q = q.eq('id', opts.opdrachtId)
  const { data: ruw } = await q.limit(3000)
  const alle = ((ruw ?? []) as { id: string; client_id: string | null; lead_id: string | null; contract_id: string | null; status: string; updated_at: string; titel: string; klant_vrij: string | null; diensten: string[] | null }[])
  const ids0 = alle.filter((o) => ACTIEF.has(kolomVan(o.status)))
  if (!ids0.length) return []
  const clientIds = [...new Set(ids0.map((o) => o.client_id).filter(Boolean))] as string[]
  const { data: kl } = clientIds.length ? await admin.from('clients').select('id, company_name').in('id', clientIds) : { data: [] }
  const naam = new Map(((kl ?? []) as { id: string; company_name: string }[]).map((k) => [k.id, k.company_name]))
  const projecten: Project[] = ids0.map((o) => ({ id: o.id, client_id: o.client_id, lead_id: o.lead_id, contract_id: o.contract_id, status: o.status, kolom: kolomVan(o.status), updated_at: o.updated_at, titel: o.titel, klant: o.client_id ? naam.get(o.client_id) ?? o.klant_vrij : o.klant_vrij, diensten: o.diensten ?? [] }))

  // Voor mails die enkel aan een klant hangen: het lopende project van die klant (ook als we er maar één opvragen).
  let perKlant = new Map<string, string>()
  {
    const metKlant = alle.filter((o) => o.client_id && ACTIEF.has(kolomVan(o.status)))
    if (opts.opdrachtId && clientIds.length) {
      const { data: broers } = await admin.from('opdrachten').select('id, client_id, status, updated_at').in('client_id', clientIds).limit(500)
      metKlant.splice(0, metKlant.length, ...((broers ?? []) as typeof alle).filter((o) => ACTIEF.has(kolomVan(o.status))))
    }
    const best = new Map<string, { id: string; updated_at: string }>()
    for (const o of metKlant) { const al = best.get(o.client_id as string); if (!al || o.updated_at > al.updated_at) best.set(o.client_id as string, { id: o.id, updated_at: o.updated_at }) }
    perKlant = new Map([...best].map(([k, v]) => [k, v.id]))
  }
  const ids = projecten.map((p) => p.id)
  const leadIds = projecten.map((p) => p.lead_id).filter(Boolean) as string[]
  const contractIds = projecten.map((p) => p.contract_id).filter(Boolean) as string[]
  const veilig = async <T,>(p: PromiseLike<{ data: T[] | null }>): Promise<T[]> => { try { return (await p).data ?? [] } catch { return [] } }
  const inOf = (kolom: string, lijst: string[]) => (lijst.length ? `${kolom}.in.(${lijst.join(',')})` : null)
  const of = (...d: (string | null)[]) => d.filter(Boolean).join(',')

  const [mails, offertes, contracten, meetings, afspraken, agenda, klaar] = await Promise.all([
    veilig(admin.from('mail_berichten').select('id, message_id, richting, onderwerp, verzonden_op, client_id, opdracht_id, fragment, ai_soort, ai_samenvatting').or(of(inOf('opdracht_id', ids), inOf('client_id', clientIds))).gte('verzonden_op', sinds).order('verzonden_op').limit(5000)),
    veilig(admin.from('offertes').select('id, titel, client_id, opdracht_id, verstuurd_op').not('verstuurd_op', 'is', null).or(of(inOf('opdracht_id', ids), inOf('client_id', clientIds))).gte('verstuurd_op', sinds).limit(2000)),
    contractIds.length ? veilig(admin.from('contracts').select('id, title, sent_at').in('id', contractIds).not('sent_at', 'is', null)) : Promise.resolve([]),
    veilig(admin.from('klant_meetings').select('id, titel, ends_at, client_id, project_id, lead_id, status').eq('status', 'ingepland').lt('ends_at', nu.toISOString()).gte('ends_at', sinds).or(of(inOf('project_id', ids), inOf('client_id', clientIds), inOf('lead_id', leadIds))).limit(2000)),
    leadIds.length ? veilig(admin.from('sales_appointments').select('id, titel, ends_at, lead_id, status').in('lead_id', leadIds).neq('status', 'cancelled').lt('ends_at', nu.toISOString()).gte('ends_at', sinds).limit(2000)) : Promise.resolve([]),
    veilig(admin.from('opvolg_meetings').select('id, event_id, titel, eind, client_id, opdracht_id').lt('eind', nu.toISOString()).gte('eind', sinds).or(of(inOf('opdracht_id', ids), inOf('client_id', clientIds))).limit(2000)),
    veilig(admin.from('mail_opvolging_afgehandeld').select('opdracht_id, sleutel').in('opdracht_id', ids)),
  ]) as [
    { id: string; message_id: string; richting: 'in' | 'uit'; onderwerp: string | null; verzonden_op: string; client_id: string | null; opdracht_id: string | null; fragment: string | null; ai_soort: string | null; ai_samenvatting: string | null }[],
    { id: string; titel: string; client_id: string | null; opdracht_id: string | null; verstuurd_op: string }[],
    { id: string; title: string; sent_at: string }[],
    { id: string; titel: string | null; ends_at: string; client_id: string | null; project_id: string | null; lead_id: string | null }[],
    { id: string; titel: string | null; ends_at: string; lead_id: string }[],
    { id: string; event_id: string; titel: string | null; eind: string; client_id: string | null; opdracht_id: string | null }[],
    { opdracht_id: string; sleutel: string }[],
  ]

  const actief = new Set(ids)
  const perLead = new Map(projecten.filter((p) => p.lead_id).map((p) => [p.lead_id as string, p.id]))
  const perContract = new Map(projecten.filter((p) => p.contract_id).map((p) => [p.contract_id as string, p.id]))
  const kies = (opdracht: string | null | undefined, client: string | null | undefined): string | null =>
    (opdracht && actief.has(opdracht) ? opdracht : null) ?? (client ? perKlant.get(client) ?? null : null)

  const ev = new Map<string, Gebeurtenis[]>(ids.map((i) => [i, []]))
  const voeg = (pid: string | null, g: Gebeurtenis) => { if (pid && ev.has(pid)) ev.get(pid)!.push(g) }
  for (const m of mails) voeg(kies(m.opdracht_id, m.client_id), { sleutel: `mail:${m.id}`, soort: m.richting, op: m.verzonden_op, titel: m.onderwerp ?? '', ai: (m.ai_soort as AiSoort | null) ?? null, samenvatting: m.ai_samenvatting, fragment: m.fragment })
  for (const o of offertes) voeg(kies(o.opdracht_id, o.client_id), { sleutel: `offerte:${o.id}`, soort: 'offerte', op: o.verstuurd_op, titel: o.titel })
  for (const c of contracten) voeg(perContract.get(c.id) ?? null, { sleutel: `contract:${c.id}`, soort: 'contract', op: c.sent_at, titel: c.title })
  for (const m of meetings) voeg(kies(m.project_id, m.client_id) ?? (m.lead_id ? perLead.get(m.lead_id) ?? null : null), { sleutel: `meeting:${m.id}`, soort: 'meeting', op: m.ends_at, titel: m.titel ?? 'Meeting' })
  for (const a of afspraken) voeg(perLead.get(a.lead_id) ?? null, { sleutel: `afspraak:${a.id}`, soort: 'meeting', op: a.ends_at, titel: a.titel ?? 'Afspraak' })
  for (const a of agenda) voeg(kies(a.opdracht_id, a.client_id), { sleutel: `agenda:${a.event_id}`, soort: 'meeting', op: a.eind, titel: a.titel ?? 'Meeting' })

  const afgehandeld = new Map<string, Set<string>>()
  for (const k of klaar) { if (!afgehandeld.has(k.opdracht_id)) afgehandeld.set(k.opdracht_id, new Set()); afgehandeld.get(k.opdracht_id)!.add(k.sleutel) }

  return projecten.map((p) => {
    const lijst = (ev.get(p.id) ?? []).map((g) => (g.soort === 'in' ? { ...g, wie: p.klant ?? null } : g)).sort((a, b) => a.op.localeCompare(b.op))
    return { project: p, gebeurtenissen: lijst, opvolging: bepaalOpvolging({ kolom: p.kolom, gebeurtenissen: lijst, afgehandeld: afgehandeld.get(p.id), nu }) }
  })
}

export type SyncStand = { gekoppeld: boolean; mailboxen: { mailbox: string; map: string; laatst_gelezen_op: string | null; fout: string | null }[] }

/** Welke mailboxen zijn gekoppeld en wanneer werden ze gelezen (zonder geheimen). */
export async function syncStand(admin: Admin): Promise<SyncStand> {
  const lijst = mailboxen().map((m) => m.gebruiker)
  const { data } = await admin.from('mail_sync_status').select('mailbox, map, laatst_gelezen_op, fout')
  return { gekoppeld: lijst.length > 0, mailboxen: ((data ?? []) as SyncStand['mailboxen']).filter((r) => lijst.includes(r.mailbox)) }
}
