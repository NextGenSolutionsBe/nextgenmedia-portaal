import 'server-only'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { leesInstellingen } from '@/lib/instellingen/laden'
import {
  leesBetrokkenen, urenPerWeek, voorstelVoor, controleerPrijs, waaromNietApart, waaromNietAfronden, workflowUren, maatVan, gemiddeldBespaard,
  type Proces, type Workflow, type Prijzen, type ProcesVoorstel,
} from './audit'

/**
 * Het auditrapport op de server (nieuwe werking fase 3). Per deal: processen en
 * workflows. Wie bouwt (recht ngs_levering) schrijft het rapport, zonder de
 * pipeline of de dealwaarden te zien. Na "Rapport afronden" ligt alles vast tot
 * iemand het weer opent. Niets wordt ooit echt verwijderd (verwijderd_op).
 */

type Admin = ReturnType<typeof createAdminSupabaseClient>
export class RapportFout extends Error { constructor(m: string, public status = 400) { super(m) } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const nu = () => new Date().toISOString()
const getal = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(String(v).replace(',', '.')))

export type RapportDeal = {
  id: string; bedrijf: string; fase: string; client_id: string | null; processen: number | null; auditdag_op: string | null; presentatie_op: string | null
  audit_notities: string | null; briefing_notities: string | null; rapport_afgerond_op: string | null; rapport_afgerond_door: string | null
}
export type Rapport = { deal: RapportDeal; processen: Proces[]; workflows: Workflow[]; prijzen: Prijzen }

const DEAL_KOL = 'id, bedrijf, fase, client_id, processen, auditdag_op, presentatie_op, audit_notities, briefing_notities, rapport_afgerond_op, rapport_afgerond_door'

async function leesDeal(admin: Admin, id: unknown): Promise<RapportDeal> {
  if (typeof id !== 'string' || !UUID.test(id)) throw new RapportFout('Deal niet gevonden.', 404)
  const { data } = await admin.from('ngs_deals').select(DEAL_KOL).eq('id', id).is('verwijderd_op', null).maybeSingle()
  if (!data) throw new RapportFout('Deal niet gevonden.', 404)
  return data as RapportDeal
}

const naarProces = (r: Record<string, unknown>): Proces => ({
  id: String(r.id), naam: String(r.naam ?? ''), betrokkenen: leesBetrokkenen(r.betrokkenen), uren_per_week: Number(r.uren_per_week ?? 0),
  notitie: (r.notitie as string | null) ?? null, workflow_id: (r.workflow_id as string | null) ?? null, volgorde: Number(r.volgorde ?? 0),
})
const naarWorkflow = (r: Record<string, unknown>): Workflow => ({
  id: String(r.id), naam: String(r.naam ?? ''), oplossing: (r.oplossing as string | null) ?? null, soort: r.soort === 'andere_waarde' ? 'andere_waarde' : 'tijd',
  geschatte_uren: getal(r.geschatte_uren), marktcheck: (r.marktcheck as string | null) ?? null, interface_of_logboek: r.interface_of_logboek === true,
  maat: r.maat === 'klein' || r.maat === 'middel' || r.maat === 'groot' ? r.maat : null, prijs: getal(r.prijs), prijs_reden: (r.prijs_reden as string | null) ?? null,
  volgorde: Number(r.volgorde ?? 0),
})

export async function laadRapport(admin: Admin, dealId: unknown): Promise<Rapport> {
  const deal = await leesDeal(admin, dealId)
  const [{ data: p }, { data: w }, inst] = await Promise.all([
    admin.from('ngs_audit_processen').select('*').eq('deal_id', deal.id).is('verwijderd_op', null).order('volgorde').order('created_at'),
    admin.from('ngs_workflows').select('*').eq('deal_id', deal.id).is('verwijderd_op', null).order('volgorde').order('created_at'),
    leesInstellingen(),
  ])
  return { deal, processen: ((p ?? []) as Record<string, unknown>[]).map(naarProces), workflows: ((w ?? []) as Record<string, unknown>[]).map(naarWorkflow), prijzen: inst.werking.prijzen }
}

/** De audits die lopen of net af zijn, voor wie het rapport schrijft (zonder dealwaarden). */
export async function auditLijst(admin: Admin): Promise<(Pick<RapportDeal, 'id' | 'bedrijf' | 'fase' | 'auditdag_op' | 'presentatie_op' | 'rapport_afgerond_op'> & { workflows: number })[]> {
  const { data } = await admin.from('ngs_deals').select('id, bedrijf, fase, auditdag_op, presentatie_op, rapport_afgerond_op').in('fase', ['audit', 'opvolgen_rapport', 'won']).is('verwijderd_op', null).not('auditdag_op', 'is', null).order('auditdag_op', { ascending: false }).limit(100)
  const rijen = (data ?? []) as (Pick<RapportDeal, 'id' | 'bedrijf' | 'fase' | 'auditdag_op' | 'presentatie_op' | 'rapport_afgerond_op'>)[]
  if (!rijen.length) return []
  const { data: w } = await admin.from('ngs_workflows').select('deal_id').in('deal_id', rijen.map((r) => r.id)).is('verwijderd_op', null)
  const tel = new Map<string, number>()
  for (const x of (w ?? []) as { deal_id: string }[]) tel.set(x.deal_id, (tel.get(x.deal_id) ?? 0) + 1)
  return rijen.map((r) => ({ ...r, workflows: tel.get(r.id) ?? 0 }))
}

async function systeem(admin: Admin, dealId: string, tekst: string, door: string | null) {
  await admin.from('ngs_deal_notities').insert({ deal_id: dealId, tekst, soort: 'systeem', door }).then(() => null, () => null)
}

/** Een open rapport: na afronden ligt alles vast tot iemand het weer opent. */
async function openRapport(admin: Admin, dealId: unknown): Promise<{ deal: RapportDeal; prijzen: Prijzen }> {
  const deal = await leesDeal(admin, dealId)
  if (deal.rapport_afgerond_op) throw new RapportFout('Het rapport is afgerond. Open het opnieuw om iets te veranderen.', 409)
  return { deal, prijzen: (await leesInstellingen()).werking.prijzen }
}

/** Een workflow voor één proces (als het minimum gehaald wordt). */
async function nieuweWorkflow(admin: Admin, dealId: string, naam: string, oplossing: string | null, volgorde: number): Promise<string> {
  const { data, error } = await admin.from('ngs_workflows').insert({ deal_id: dealId, naam, oplossing, soort: 'tijd', volgorde }).select('id').single()
  if (error) throw new Error(error.message)
  return String((data as { id: string }).id)
}

/** Workflows zonder processen meer (na bundelen of loskoppelen) gaan weg, zonder dat er iets verloren gaat. */
async function ruimLegeWorkflowsOp(admin: Admin, dealId: string) {
  const [{ data: w }, { data: p }] = await Promise.all([
    admin.from('ngs_workflows').select('id, soort').eq('deal_id', dealId).is('verwijderd_op', null),
    admin.from('ngs_audit_processen').select('workflow_id').eq('deal_id', dealId).is('verwijderd_op', null),
  ])
  const gebruikt = new Set(((p ?? []) as { workflow_id: string | null }[]).map((x) => x.workflow_id).filter(Boolean))
  const leeg = ((w ?? []) as { id: string; soort: string }[]).filter((x) => x.soort === 'tijd' && !gebruikt.has(x.id)).map((x) => x.id)
  if (leeg.length) await admin.from('ngs_workflows').update({ verwijderd_op: nu() }).in('id', leeg)
}

/** Een proces: haalt het het minimum, dan meteen een eigen workflow; anders blijft het los (te bundelen). */
async function voegProcesToe(admin: Admin, dealId: string, b: { naam?: unknown; betrokkenen?: unknown; notitie?: unknown; oplossing?: unknown; workflow_id?: unknown }, p: Prijzen, volgorde: number): Promise<string> {
  const naam = String(b.naam ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
  if (!naam) throw new RapportFout('Hoe heet het proces?')
  const betrokkenen = leesBetrokkenen(b.betrokkenen)
  const uren = urenPerWeek(betrokkenen)
  let workflow: string | null = null
  if (typeof b.workflow_id === 'string' && UUID.test(b.workflow_id)) {
    const { data } = await admin.from('ngs_workflows').select('id').eq('id', b.workflow_id).eq('deal_id', dealId).is('verwijderd_op', null).maybeSingle()
    workflow = data ? b.workflow_id : null
  } else if (uren >= p.min_uren) {
    workflow = await nieuweWorkflow(admin, dealId, naam, String(b.oplossing ?? '').trim().slice(0, 4000) || null, volgorde)
  }
  const { data, error } = await admin.from('ngs_audit_processen').insert({
    deal_id: dealId, naam, betrokkenen, uren_per_week: uren, notitie: String(b.notitie ?? '').trim().slice(0, 2000) || null, workflow_id: workflow, volgorde,
  }).select('id').single()
  if (error) throw new Error(error.message)
  if (workflow) await herrekenVoorstel(admin, workflow, dealId, p)
  return String((data as { id: string }).id)
}

/** Maat en prijs van een workflow opnieuw uit de formule, zolang niemand zelf een prijs koos. */
async function herrekenVoorstel(admin: Admin, workflowId: string, dealId: string, p: Prijzen) {
  const { data: w } = await admin.from('ngs_workflows').select('*').eq('id', workflowId).maybeSingle()
  if (!w) return
  const wf = naarWorkflow(w as Record<string, unknown>)
  const { data: pr } = await admin.from('ngs_audit_processen').select('workflow_id, uren_per_week').eq('deal_id', dealId).is('verwijderd_op', null)
  const uren = workflowUren(wf, ((pr ?? []) as { workflow_id: string | null; uren_per_week: number }[]).map((x) => ({ workflow_id: x.workflow_id, uren_per_week: Number(x.uren_per_week) })))
  const v = voorstelVoor(wf, uren, p)
  // Een prijs met een reden is bewust gekozen: die laten we staan; de maat volgt de uren.
  const patch: Record<string, unknown> = { maat: v.maat, updated_at: nu() }
  if (!wf.prijs_reden) patch.prijs = v.prijs
  await admin.from('ngs_workflows').update(patch).eq('id', workflowId)
}

export async function rapportActie(admin: Admin, b: Record<string, unknown>, door: string | null): Promise<Record<string, unknown>> {
  const actie = String(b.actie ?? '')
  if (actie === 'heropen') {
    const deal = await leesDeal(admin, b.deal)
    await admin.from('ngs_deals').update({ rapport_afgerond_op: null, rapport_afgerond_door: null, updated_at: nu() }).eq('id', deal.id)
    await systeem(admin, deal.id, 'Rapport weer geopend', door)
    return { ok: true }
  }
  const { deal, prijzen } = await openRapport(admin, b.deal)

  if (actie === 'notities') {
    const patch: Record<string, unknown> = { updated_at: nu() }
    if (b.audit_notities !== undefined) patch.audit_notities = String(b.audit_notities ?? '').slice(0, 30000) || null
    if (b.briefing_notities !== undefined) patch.briefing_notities = String(b.briefing_notities ?? '').slice(0, 30000) || null
    const { error } = await admin.from('ngs_deals').update(patch).eq('id', deal.id)
    if (error) throw new Error(error.message)
    return { ok: true }
  }
  if (actie === 'proces.nieuw') {
    const { count } = await admin.from('ngs_audit_processen').select('id', { count: 'exact', head: true }).eq('deal_id', deal.id).is('verwijderd_op', null)
    return { ok: true, id: await voegProcesToe(admin, deal.id, b, prijzen, (count ?? 0) + 1) }
  }
  if (actie === 'voorstel.overnemen') {
    const lijst = (Array.isArray(b.processen) ? b.processen : []).slice(0, 20) as ProcesVoorstel[]
    const { count } = await admin.from('ngs_audit_processen').select('id', { count: 'exact', head: true }).eq('deal_id', deal.id).is('verwijderd_op', null)
    let i = count ?? 0
    for (const x of lijst) await voegProcesToe(admin, deal.id, { naam: x.naam, betrokkenen: x.betrokkenen, oplossing: x.oplossing }, prijzen, ++i)
    await systeem(admin, deal.id, `Voorstel van de AI overgenomen: ${lijst.length} ${lijst.length === 1 ? 'proces' : 'processen'}`, door)
    return { ok: true }
  }
  if (actie === 'proces.wijzig' || actie === 'proces.weg' || actie === 'proces.los') {
    const id = String(b.id ?? '')
    if (!UUID.test(id)) throw new RapportFout('Proces niet gevonden.', 404)
    const { data: oud } = await admin.from('ngs_audit_processen').select('*').eq('id', id).eq('deal_id', deal.id).is('verwijderd_op', null).maybeSingle()
    if (!oud) throw new RapportFout('Proces niet gevonden.', 404)
    const pr = naarProces(oud as Record<string, unknown>)
    if (actie === 'proces.weg') await admin.from('ngs_audit_processen').update({ verwijderd_op: nu() }).eq('id', id)
    else if (actie === 'proces.los') await admin.from('ngs_audit_processen').update({ workflow_id: null, updated_at: nu() }).eq('id', id)
    else {
      const naam = String(b.naam ?? pr.naam).replace(/\s+/g, ' ').trim().slice(0, 160)
      if (!naam) throw new RapportFout('Hoe heet het proces?')
      const betrokkenen = b.betrokkenen !== undefined ? leesBetrokkenen(b.betrokkenen) : pr.betrokkenen
      await admin.from('ngs_audit_processen').update({ naam, betrokkenen, uren_per_week: urenPerWeek(betrokkenen), notitie: b.notitie !== undefined ? String(b.notitie ?? '').trim().slice(0, 2000) || null : pr.notitie, updated_at: nu() }).eq('id', id)
      // Een los proces dat nu het minimum haalt, krijgt zijn eigen workflow.
      if (!pr.workflow_id && urenPerWeek(betrokkenen) >= prijzen.min_uren) {
        const w = await nieuweWorkflow(admin, deal.id, naam, null, pr.volgorde)
        await admin.from('ngs_audit_processen').update({ workflow_id: w }).eq('id', id)
      }
    }
    if (pr.workflow_id) await herrekenVoorstel(admin, pr.workflow_id, deal.id, prijzen)
    await ruimLegeWorkflowsOp(admin, deal.id)
    return { ok: true }
  }
  if (actie === 'samenvoegen') {
    // Processen bundelen tot één workflow: samen minstens het minimum.
    const ids = (Array.isArray(b.processen) ? b.processen : []).map(String).filter((x) => UUID.test(x))
    if (ids.length < 2) throw new RapportFout('Kies minstens twee processen.')
    const { data } = await admin.from('ngs_audit_processen').select('*').eq('deal_id', deal.id).in('id', ids).is('verwijderd_op', null)
    const lijst = ((data ?? []) as Record<string, unknown>[]).map(naarProces)
    if (lijst.length < 2) throw new RapportFout('Kies minstens twee processen.')
    const uren = lijst.reduce((s, x) => s + x.uren_per_week, 0)
    if (uren < prijzen.min_uren) throw new RapportFout(`Samen ${uren} uur per week: nog altijd minder dan ${prijzen.min_uren}. Bundel er nog een proces bij.`)
    const bestaand = lijst.find((x) => x.workflow_id)?.workflow_id ?? null
    const naam = String(b.naam ?? '').trim().slice(0, 160) || lijst.map((x) => x.naam).join(' + ').slice(0, 160)
    const workflow = bestaand ?? await nieuweWorkflow(admin, deal.id, naam, null, Math.min(...lijst.map((x) => x.volgorde)))
    if (bestaand) await admin.from('ngs_workflows').update({ naam, updated_at: nu() }).eq('id', bestaand)
    await admin.from('ngs_audit_processen').update({ workflow_id: workflow, updated_at: nu() }).in('id', lijst.map((x) => x.id))
    await herrekenVoorstel(admin, workflow, deal.id, prijzen)
    await ruimLegeWorkflowsOp(admin, deal.id)
    return { ok: true, workflow }
  }
  if (actie === 'workflow.andere') {
    const naam = String(b.naam ?? '').replace(/\s+/g, ' ').trim().slice(0, 160)
    if (!naam) throw new RapportFout('Hoe heet het project?')
    const { data, error } = await admin.from('ngs_workflows').insert({ deal_id: deal.id, naam, soort: 'andere_waarde', volgorde: 999 }).select('id').single()
    if (error) throw new Error(error.message)
    return { ok: true, id: (data as { id: string }).id }
  }
  if (actie === 'workflow.wijzig' || actie === 'workflow.weg') {
    const id = String(b.id ?? '')
    if (!UUID.test(id)) throw new RapportFout('Workflow niet gevonden.', 404)
    const { data: w } = await admin.from('ngs_workflows').select('*').eq('id', id).eq('deal_id', deal.id).is('verwijderd_op', null).maybeSingle()
    if (!w) throw new RapportFout('Workflow niet gevonden.', 404)
    if (actie === 'workflow.weg') {
      await admin.from('ngs_workflows').update({ verwijderd_op: nu() }).eq('id', id)
      await admin.from('ngs_audit_processen').update({ workflow_id: null }).eq('workflow_id', id)
      return { ok: true }
    }
    const wf = naarWorkflow(w as Record<string, unknown>)
    const { data: pr } = await admin.from('ngs_audit_processen').select('workflow_id, uren_per_week').eq('deal_id', deal.id).is('verwijderd_op', null)
    const uren = workflowUren(wf, ((pr ?? []) as { workflow_id: string | null; uren_per_week: number }[]).map((x) => ({ workflow_id: x.workflow_id, uren_per_week: Number(x.uren_per_week) })))
    const soort = wf.soort
    const geschat = soort === 'andere_waarde' ? getal(b.geschatte_uren ?? wf.geschatte_uren) : null
    const patch: Record<string, unknown> = {
      naam: String(b.naam ?? wf.naam).replace(/\s+/g, ' ').trim().slice(0, 160) || wf.naam,
      oplossing: b.oplossing !== undefined ? String(b.oplossing ?? '').trim().slice(0, 4000) || null : wf.oplossing,
      interface_of_logboek: b.interface_of_logboek !== undefined ? b.interface_of_logboek === true : wf.interface_of_logboek,
      updated_at: nu(),
    }
    if (soort === 'andere_waarde') {
      if (geschat !== null && !(geschat > 0 && geschat <= 10_000)) throw new RapportFout('Het aantal geschatte uren klopt niet.')
      patch.geschatte_uren = geschat
      patch.marktcheck = b.marktcheck !== undefined ? String(b.marktcheck ?? '').trim().slice(0, 2000) || null : wf.marktcheck
      patch.maat = null
    } else {
      // Onder het minimum kan een workflow niet apart bewaard worden.
      const apart = waaromNietApart(wf, uren, prijzen)
      if (apart && b.prijs !== undefined) throw new RapportFout(apart)
      patch.maat = maatVan(uren, prijzen)
    }
    if (b.prijs !== undefined && b.prijs !== null && b.prijs !== '') {
      const c = controleerPrijs(soort === 'tijd' ? (patch.maat as Workflow['maat']) : null, b.prijs, b.prijs_reden, prijzen)
      if (!c.ok) throw new RapportFout(c.fout)
      patch.prijs = c.prijs
      patch.prijs_reden = c.reden
    } else if (b.prijs === null || b.prijs === '') {
      // Terug naar de formule.
      patch.prijs = voorstelVoor({ soort, geschatte_uren: geschat ?? wf.geschatte_uren }, uren, prijzen).prijs
      patch.prijs_reden = null
    } else if (soort === 'andere_waarde' && !wf.prijs_reden) {
      patch.prijs = voorstelVoor({ soort, geschatte_uren: geschat }, uren, prijzen).prijs
    }
    const { error } = await admin.from('ngs_workflows').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    return { ok: true }
  }
  if (actie === 'afronden') {
    const r = await laadRapport(admin, deal.id)
    const waarom = waaromNietAfronden(r.workflows, r.processen, prijzen)
    if (waarom) throw new RapportFout(waarom)
    // De stap "Rapport" in de checklist van de audit vinkt mee af.
    const { data: cl } = await admin.from('ngs_deals').select('audit_checklist').eq('id', deal.id).maybeSingle()
    const lijst = { ...(((cl as { audit_checklist?: Record<string, string | null> } | null)?.audit_checklist) ?? {}) }
    if (!lijst.rapport) lijst.rapport = nu()
    await admin.from('ngs_deals').update({ rapport_afgerond_op: nu(), rapport_afgerond_door: door, audit_checklist: lijst, updated_at: nu() }).eq('id', deal.id)
    const totaal = r.workflows.reduce((s, w) => s + (w.prijs ?? 0), 0)
    await systeem(admin, deal.id, `Rapport afgerond: ${r.workflows.length} ${r.workflows.length === 1 ? 'workflow' : 'workflows'}, samen € ${totaal.toLocaleString('nl-BE')}`, door)
    return { ok: true }
  }
  throw new RapportFout('Onbekende actie.')
}

/** Gemiddeld bespaard per workflow uit afgeronde rapporten (Cijfers). */
export async function gemiddeldPerWorkflow(admin: Admin): Promise<{ aantal: number; gemiddeld: number | null }> {
  const { data: deals } = await admin.from('ngs_deals').select('id').not('rapport_afgerond_op', 'is', null).is('verwijderd_op', null)
  const ids = ((deals ?? []) as { id: string }[]).map((d) => d.id)
  if (!ids.length) return { aantal: 0, gemiddeld: null }
  const [{ data: w }, { data: p }] = await Promise.all([
    admin.from('ngs_workflows').select('id, soort').in('deal_id', ids).is('verwijderd_op', null).eq('soort', 'tijd'),
    admin.from('ngs_audit_processen').select('workflow_id, uren_per_week').in('deal_id', ids).is('verwijderd_op', null),
  ])
  const pr = ((p ?? []) as { workflow_id: string | null; uren_per_week: number }[]).map((x) => ({ workflow_id: x.workflow_id, uren_per_week: Number(x.uren_per_week) }))
  return gemiddeldBespaard(((w ?? []) as { id: string }[]).map((x) => ({ uren: workflowUren(x, pr) })))
}
