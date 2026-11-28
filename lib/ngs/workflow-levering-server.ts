import 'server-only'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { leesInstellingen } from '@/lib/instellingen/laden'
import type { ProjectFase } from './levering'
import {
  isWfFase, wfFaseLabel, waaromNietNaarWf, faseWissel, wachtStart, wachtStop, leesLink, leesZelfCalls, projectFaseUitWorkflows,
  bouwTeLaat, bouwDeadline, nazorgStand, klantWfLevering, videoMail, type WfLevering, type WfFase, type KlantWfLevering, type ZelfCall,
} from './workflow-levering'

/**
 * Levering per workflow op de server (nieuwe werking fase 4). De workflows komen
 * uit het auditrapport van de deal (fase 3) en krijgen bij het overnemen het
 * leveringsproject. Niets wordt verwijderd: weghalen = verwijderd_op. Elke stap
 * komt als regel in de tijdlijn van de deal.
 */
type Admin = ReturnType<typeof createAdminSupabaseClient>

export class WfFout extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const moetId = (id: unknown, wat = 'Workflow'): string => { if (typeof id !== 'string' || !UUID.test(id)) throw new WfFout(`${wat} niet gevonden.`, 404); return id }
const nu = () => new Date().toISOString()
const vandaag = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const getal = (v: unknown) => (v === null || v === undefined ? null : Number(v))
const tekstOf = (v: unknown) => (v === null || v === undefined ? null : String(v))

export function naarWf(r: Record<string, unknown>): WfLevering {
  return {
    id: String(r.id), project_id: tekstOf(r.project_id), deal_id: tekstOf(r.deal_id), naam: String(r.naam ?? ''), oplossing: tekstOf(r.oplossing),
    maat: tekstOf(r.maat), prijs: getal(r.prijs), interface_of_logboek: r.interface_of_logboek === true, volgorde: Number(r.volgorde ?? 0),
    fase: isWfFase(r.fase) ? r.fase : 'gepland', fase_sinds: tekstOf(r.fase_sinds), bouw_start: tekstOf(r.bouw_start),
    wacht_op_klant: r.wacht_op_klant === true, wacht_reden: tekstOf(r.wacht_reden), wacht_sinds: tekstOf(r.wacht_sinds), wacht_dagen: Number(r.wacht_dagen ?? 0),
    opname_link: tekstOf(r.opname_link), video_link: tekstOf(r.video_link), video_gestuurd_op: tekstOf(r.video_gestuurd_op),
    oplevering_op: tekstOf(r.oplevering_op), nazorg_start: tekstOf(r.nazorg_start), nazorg_calls: leesZelfCalls(r.nazorg_calls), klaar_op: tekstOf(r.klaar_op),
    verantwoordelijke: tekstOf(r.verantwoordelijke),
  }
}

async function tijdlijn(admin: Admin, dealId: string | null, tekst: string, door: string | null) {
  if (!dealId) return
  await admin.from('ngs_deal_notities').insert({ deal_id: dealId, tekst, soort: 'systeem', door })
}

export type WfCall = { id: string | null; op: string; titel: string; bron: 'meeting' | 'zelf'; notitie: string | null; index: number | null }
export type WorkflowsVanProject = {
  workflows: (WfLevering & { calls: WfCall[] })[]
  /** Workflows in het rapport van de deal die nog niet overgenomen zijn. */
  uitRapport: { aantal: number; afgerond: boolean }
  levering: Awaited<ReturnType<typeof leesInstellingen>>['werking']['levering']
}

/** De workflows van een project, met hun nazorgcalls (Meeting Inplanner + zelf ingevuld). */
export async function workflowsVanProject(admin: Admin, projectIdIn: unknown): Promise<WorkflowsVanProject> {
  const projectId = moetId(projectIdIn, 'Project')
  const [{ data: p }, { data: w }, inst] = await Promise.all([
    admin.from('ngs_projecten').select('id, deal_id').eq('id', projectId).maybeSingle(),
    admin.from('ngs_workflows').select('*').eq('project_id', projectId).is('verwijderd_op', null).order('volgorde').order('created_at'),
    leesInstellingen(),
  ])
  if (!p) throw new WfFout('Project niet gevonden.', 404)
  const ws = ((w ?? []) as Record<string, unknown>[]).map(naarWf)
  const dealId = (p as { deal_id: string | null }).deal_id
  const [{ data: m }, rapport] = await Promise.all([
    ws.length ? admin.from('klant_meetings').select('id, titel, starts_at, status, ngs_workflow_id').in('ngs_workflow_id', ws.map((x) => x.id)).neq('status', 'geannuleerd') : Promise.resolve({ data: [] }),
    dealId ? Promise.all([
      admin.from('ngs_workflows').select('id', { count: 'exact', head: true }).eq('deal_id', dealId).is('project_id', null).is('verwijderd_op', null),
      admin.from('ngs_deals').select('rapport_afgerond_op').eq('id', dealId).maybeSingle(),
    ]) : Promise.resolve(null),
  ])
  const perWf = new Map<string, WfCall[]>()
  for (const r of (m ?? []) as { id: string; titel: string; starts_at: string; ngs_workflow_id: string }[]) {
    const l = perWf.get(r.ngs_workflow_id) ?? []
    l.push({ id: r.id, op: r.starts_at, titel: r.titel, bron: 'meeting', notitie: null, index: null })
    perWf.set(r.ngs_workflow_id, l)
  }
  return {
    workflows: ws.map((x) => ({
      ...x,
      calls: [...(perWf.get(x.id) ?? []), ...x.nazorg_calls.map((c, i) => ({ id: null, op: c.op, titel: 'Call (buiten de app)', bron: 'zelf' as const, notitie: c.notitie, index: i }))].sort((a, b) => a.op.localeCompare(b.op)),
    })),
    uitRapport: rapport ? { aantal: rapport[0].count ?? 0, afgerond: !!(rapport[1].data as { rapport_afgerond_op: string | null } | null)?.rapport_afgerond_op } : { aantal: 0, afgerond: false },
    levering: inst.werking.levering,
  }
}

/** De fase van het project volgt de workflows (de vroegste die nog loopt). */
async function volgProject(admin: Admin, projectId: string, door: string | null) {
  const [{ data: p }, { data: w }] = await Promise.all([
    admin.from('ngs_projecten').select('id, fase, deal_id').eq('id', projectId).maybeSingle(),
    admin.from('ngs_workflows').select('fase, volgorde').eq('project_id', projectId).is('verwijderd_op', null),
  ])
  if (!p) return
  const pr = p as { id: string; fase: ProjectFase; deal_id: string | null }
  const fase = projectFaseUitWorkflows(((w ?? []) as { fase: string; volgorde: number }[]).map((x) => ({ fase: isWfFase(x.fase) ? x.fase : 'gepland', volgorde: Number(x.volgorde) })), pr.fase)
  if (!fase) return
  await admin.from('ngs_projecten').update({ fase, fase_sinds: nu(), updated_at: nu() }).eq('id', pr.id)
  void door
}

async function leesWf(admin: Admin, idIn: unknown): Promise<WfLevering> {
  const { data } = await admin.from('ngs_workflows').select('*').eq('id', moetId(idIn)).is('verwijderd_op', null).maybeSingle()
  if (!data) throw new WfFout('Workflow niet gevonden.', 404)
  const w = naarWf(data as Record<string, unknown>)
  if (!w.project_id) throw new WfFout('Deze workflow hangt nog aan geen leveringsproject.')
  return w
}
async function zetWf(admin: Admin, id: string, patch: Partial<WfLevering> | Record<string, unknown>) {
  const { error } = await admin.from('ngs_workflows').update({ ...patch, updated_at: nu() }).eq('id', id)
  if (error) throw new Error(error.message)
}

/**
 * Workflows uit het afgeronde rapport overnemen in het project (één klik).
 * Ze starten op Gepland, met de standaard verantwoordelijke uit Instellingen.
 */
export async function overnemenUitRapport(admin: Admin, projectIdIn: unknown, door: string | null): Promise<number> {
  const projectId = moetId(projectIdIn, 'Project')
  const { data: p } = await admin.from('ngs_projecten').select('id, deal_id').eq('id', projectId).is('gearchiveerd_op', null).maybeSingle()
  const dealId = (p as { deal_id: string | null } | null)?.deal_id
  if (!p || !dealId) throw new WfFout('Dit project hangt aan geen deal met een auditrapport.')
  const { data: d } = await admin.from('ngs_deals').select('rapport_afgerond_op').eq('id', dealId).maybeSingle()
  if (!(d as { rapport_afgerond_op: string | null } | null)?.rapport_afgerond_op) throw new WfFout('Het auditrapport is nog niet afgerond.')
  const inst = await leesInstellingen()
  const { data, error } = await admin.from('ngs_workflows')
    .update({ project_id: projectId, fase: 'gepland', fase_sinds: nu(), verantwoordelijke: inst.werking.levering.verantwoordelijke, updated_at: nu() })
    .eq('deal_id', dealId).is('project_id', null).is('verwijderd_op', null).select('id')
  if (error) throw new Error(error.message)
  const n = (data ?? []).length
  if (n) await tijdlijn(admin, dealId, `Levering: ${n} ${n === 1 ? 'workflow' : 'workflows'} uit het auditrapport overgenomen`, door)
  return n
}

/** Een workflow zonder rapport (bv. een klein project), enkel met een naam. */
export async function nieuweWorkflow(admin: Admin, projectIdIn: unknown, naamIn: unknown, door: string | null): Promise<string> {
  const projectId = moetId(projectIdIn, 'Project')
  const naam = String(naamIn ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
  if (naam.length < 2) throw new WfFout('Geef de workflow een naam.')
  const { data: p } = await admin.from('ngs_projecten').select('id, deal_id').eq('id', projectId).is('gearchiveerd_op', null).maybeSingle()
  if (!p) throw new WfFout('Project niet gevonden.', 404)
  const [{ data: max }, inst] = await Promise.all([
    admin.from('ngs_workflows').select('volgorde').eq('project_id', projectId).order('volgorde', { ascending: false }).limit(1),
    leesInstellingen(),
  ])
  const volgorde = Number(((max ?? [])[0] as { volgorde: number } | undefined)?.volgorde ?? 0) + 1
  const dealId = (p as { deal_id: string | null }).deal_id
  const { data, error } = await admin.from('ngs_workflows')
    .insert({ project_id: projectId, deal_id: dealId, naam, volgorde, fase: 'gepland', fase_sinds: nu(), verantwoordelijke: inst.werking.levering.verantwoordelijke })
    .select('id').single()
  if (error) throw new Error(error.message)
  await tijdlijn(admin, dealId, `Levering: workflow "${naam}" toegevoegd`, door)
  return (data as { id: string }).id
}

/** Alle acties op één workflow. */
export async function workflowActie(admin: Admin, b: Record<string, unknown>, door: string | null): Promise<Record<string, unknown>> {
  const w = await leesWf(admin, b.workflow)
  const actie = String(b.actie)
  const t = nu()

  if (actie === 'wf.fase') {
    if (!isWfFase(b.naar)) throw new WfFout('Onbekende fase.')
    const naar: WfFase = b.naar
    if (naar === w.fase) return { ok: true }
    const { data: s } = await admin.from('ngs_user_stories').select('status').eq('workflow_id', w.id).is('verwijderd_op', null)
    const fout = waaromNietNaarWf(w, naar, (s ?? []) as { status: string }[])
    if (fout) throw new WfFout(fout)
    await zetWf(admin, w.id, faseWissel(w, naar, t))
    await tijdlijn(admin, w.deal_id, `${w.naam}: ${wfFaseLabel(w.fase)} → ${wfFaseLabel(naar)}`, door)
    await volgProject(admin, w.project_id!, door)
    // Bij de oplevering komt de factuur van de workflow klaar (fase 5), één keer.
    if (['oplevering', 'nazorg', 'klaar'].includes(naar)) {
      try {
        const { maakWorkflowFactuur } = await import('./facturatie-server')
        const f = await maakWorkflowFactuur(admin, w.id, door)
        if (f) return { ok: true, factuur: f }
      } catch (e) {
        return { ok: true, waarschuwing: `De factuur kon niet klaargezet worden (${e instanceof Error ? e.message : 'onbekende fout'}). Maak ze met de hand bij Facturen.` }
      }
    }
    return { ok: true }
  }
  if (actie === 'wf.wacht') {
    const r = wachtStart(w, b.reden, t)
    if (!r.ok) throw new WfFout(r.fout)
    await zetWf(admin, w.id, r.patch)
    await tijdlijn(admin, w.deal_id, `${w.naam}: wacht op de klant (${r.patch.wacht_reden})`, door)
    return { ok: true }
  }
  if (actie === 'wf.wacht_stop') {
    const p = wachtStop(w, t)
    if (!p) return { ok: true }
    await zetWf(admin, w.id, p)
    await tijdlijn(admin, w.deal_id, `${w.naam}: wacht niet meer op de klant`, door)
    return { ok: true }
  }
  if (actie === 'wf.links') {
    const patch: Record<string, unknown> = {}
    for (const k of ['opname_link', 'video_link'] as const) {
      if (!(k in b)) continue
      const l = leesLink(b[k])
      if (!l.ok) throw new WfFout(l.fout)
      patch[k] = l.link
    }
    // Een andere video = opnieuw naar de klant sturen.
    if ('video_link' in patch && patch.video_link !== w.video_link) { patch.video_gestuurd_op = null; patch.video_email_id = null }
    if (Object.keys(patch).length) await zetWf(admin, w.id, patch)
    return { ok: true }
  }
  if (actie === 'wf.wijzig') {
    const patch: Record<string, unknown> = {}
    if (typeof b.verantwoordelijke === 'string') patch.verantwoordelijke = b.verantwoordelijke.replace(/\s+/g, ' ').trim().slice(0, 80) || null
    if (typeof b.interface_of_logboek === 'boolean') patch.interface_of_logboek = b.interface_of_logboek
    if (typeof b.naam === 'string' && b.naam.trim().length >= 2) patch.naam = b.naam.replace(/\s+/g, ' ').trim().slice(0, 160)
    if (typeof b.oplossing === 'string') patch.oplossing = b.oplossing.trim().slice(0, 2000) || null
    if (Object.keys(patch).length) await zetWf(admin, w.id, patch)
    return { ok: true }
  }
  if (actie === 'wf.call') {
    const [nieuw] = leesZelfCalls([{ op: b.op, notitie: b.notitie }])
    if (!nieuw) throw new WfFout('Kies de datum van de call.')
    await zetWf(admin, w.id, { nazorg_calls: [...w.nazorg_calls, nieuw] as ZelfCall[] })
    await tijdlijn(admin, w.deal_id, `${w.naam}: nazorgcall op ${nieuw.op}`, door)
    return { ok: true }
  }
  if (actie === 'wf.call_weg') {
    const i = Number(b.index)
    if (!Number.isInteger(i) || i < 0 || i >= w.nazorg_calls.length) throw new WfFout('Call niet gevonden.', 404)
    await zetWf(admin, w.id, { nazorg_calls: w.nazorg_calls.filter((_, j) => j !== i) })
    return { ok: true }
  }
  if (actie === 'wf.video_gestuurd') {
    // Enkel na een echte verzending uit het mailvenster (id uit het E-mail Center).
    const emailId = typeof b.email_id === 'string' && UUID.test(b.email_id) ? b.email_id : null
    if (!emailId) throw new WfFout('Geen verzonden mail gevonden.')
    const { data: m } = await admin.from('email_messages').select('id').eq('id', emailId).maybeSingle()
    if (!m) throw new WfFout('Geen verzonden mail gevonden.')
    await zetWf(admin, w.id, { video_gestuurd_op: t, video_email_id: emailId })
    await tijdlijn(admin, w.deal_id, `${w.naam}: video naar de klant gestuurd`, door)
    return { ok: true }
  }
  if (actie === 'wf.weg') {
    if (w.fase !== 'gepland') throw new WfFout('Enkel een workflow die nog op Gepland staat, kan weg.')
    await zetWf(admin, w.id, { verwijderd_op: t })
    await tijdlijn(admin, w.deal_id, `${w.naam}: workflow weggehaald uit de levering`, door)
    await volgProject(admin, w.project_id!, door)
    return { ok: true }
  }
  throw new WfFout('Onbekende actie.')
}

/** Het voorstel voor de mail met de video: naar het adres van de klant, met de video als knop. */
export async function videoMailVoorstel(admin: Admin, idIn: unknown, afzender: string | null): Promise<{ aan: string; onderwerp: string; tekst: string; knop: string; link: string; client_id: string | null }> {
  const w = await leesWf(admin, idIn)
  if (!w.video_link) throw new WfFout('Vul eerst de link naar de video in.')
  const [{ data: p }, inst] = await Promise.all([
    admin.from('ngs_projecten').select('client_id').eq('id', w.project_id!).maybeSingle(),
    leesInstellingen(),
  ])
  const clientId = (p as { client_id: string | null } | null)?.client_id ?? null
  const { data: k } = clientId ? await admin.from('clients').select('contact_name, email').eq('id', clientId).maybeSingle() : { data: null }
  const klant = k as { contact_name: string | null; email: string | null } | null
  const m = videoMail({ naam: w.naam, nazorgWeken: inst.werking.levering.nazorg_weken, afzender })
  const voornaam = (klant?.contact_name ?? '').trim().split(/\s+/)[0] || ''
  return {
    aan: klant?.email ?? '', onderwerp: m.onderwerp, knop: m.knop, link: w.video_link, client_id: clientId,
    tekst: voornaam ? m.tekst.replace('[voornaam]', voornaam) : m.tekst.replace('Hallo [voornaam],', 'Hallo,'),
  }
}

/** Op te volgen: bouw over tijd zonder Wacht op klant, en nazorg zonder call deze week. */
export async function leveringOpvolgen(admin: Admin): Promise<{ id: string; naam: string; projectId: string; soort: 'bouw' | 'nazorg'; deadline: string; klant: string | null; clientId: string | null; wie: string | null }[]> {
  const { data } = await admin.from('ngs_workflows').select('*').in('fase', ['bouw', 'nazorg']).is('verwijderd_op', null).not('project_id', 'is', null).limit(500)
  const ws = ((data ?? []) as Record<string, unknown>[]).map(naarWf)
  if (!ws.length) return []
  const [inst, { data: m }, { data: p }] = await Promise.all([
    leesInstellingen(),
    admin.from('klant_meetings').select('starts_at, ngs_workflow_id').in('ngs_workflow_id', ws.map((w) => w.id)).neq('status', 'geannuleerd'),
    admin.from('ngs_projecten').select('id, client_id').in('id', [...new Set(ws.map((w) => w.project_id!))]).is('gearchiveerd_op', null),
  ])
  const L = inst.werking.levering
  const d = vandaag()
  const clientVan = new Map(((p ?? []) as { id: string; client_id: string | null }[]).map((x) => [x.id, x.client_id]))
  const ids = [...new Set([...clientVan.values()].filter((x): x is string => !!x))]
  const { data: c } = ids.length ? await admin.from('clients').select('id, company_name').in('id', ids) : { data: [] }
  const naam = new Map(((c ?? []) as { id: string; company_name: string }[]).map((x) => [x.id, x.company_name]))
  const out: Awaited<ReturnType<typeof leveringOpvolgen>> = []
  for (const w of ws) {
    if (!clientVan.has(w.project_id!)) continue // gearchiveerd project
    const clientId = clientVan.get(w.project_id!) ?? null
    const basis = { id: w.id, naam: w.naam, projectId: w.project_id!, klant: clientId ? naam.get(clientId) ?? null : null, clientId, wie: w.verantwoordelijke }
    if (w.fase === 'bouw' && bouwTeLaat(w, d, L)) out.push({ ...basis, soort: 'bouw', deadline: bouwDeadline(w, L)! })
    if (w.fase === 'nazorg') {
      const calls = [...((m ?? []) as { starts_at: string; ngs_workflow_id: string }[]).filter((x) => x.ngs_workflow_id === w.id).map((x) => ({ op: x.starts_at })), ...w.nazorg_calls]
      const st = nazorgStand(w, calls, d, L)
      if (st.teLaat && st.volgendeTegen) out.push({ ...basis, soort: 'nazorg', deadline: st.volgendeTegen })
    }
  }
  return out
}

/** Klantapp: de workflows van de projecten van deze klant, enkel de velden die de klant mag zien. */
export async function klantWorkflows(admin: Admin, projectIds: string[]): Promise<Record<string, KlantWfLevering[]>> {
  if (!projectIds.length) return {}
  const { data } = await admin.from('ngs_workflows').select('*').in('project_id', projectIds).is('verwijderd_op', null).order('volgorde').order('created_at')
  const out: Record<string, KlantWfLevering[]> = {}
  for (const w of ((data ?? []) as Record<string, unknown>[]).map(naarWf)) (out[w.project_id!] ??= []).push(klantWfLevering(w))
  return out
}
