import 'server-only'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import { controleerReeks } from '@/lib/agenda/reeksen'
import {
  netteBriefing, briefingOntbreekt, TIJDSCAN_SJABLOON, controleerStory, nieuweDod, netteDod, waaromNietKlaar,
  planUitStories, waaromNietNaar, isProjectFase, isStoryStatus, projectFaseLabel, storyStatusLabel, actiepuntenUit,
  controleerCare, planTeLaat, volgendeControle,
  type Briefing, type ProjectFase, type UserStory, type CareItem, type Actiepunt, type StoryInvoer,
} from './levering'

/**
 * Levering van NextGenSolutions op de server (verbeterplan fase 5). De pipeline
 * (lib/ngs/server.ts) blijft zoals ze was; hier komt wat na Closed Won gebeurt.
 * Nooit iets verwijderen: stories en care gaan naar een archief, projecten ook.
 * Elke stap komt als regel in de tijdlijn van de deal (ngs_deal_notities).
 */
type Admin = ReturnType<typeof createAdminSupabaseClient>

export class LeveringFout extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const vandaag = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const nu = () => new Date().toISOString()
const eur = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const moetId = (id: unknown, wat = 'Project'): string => { if (typeof id !== 'string' || !UUID.test(id)) throw new LeveringFout(`${wat} niet gevonden.`, 404); return id }

export type Project = {
  id: string; deal_id: string | null; client_id: string | null; titel: string; fase: ProjectFase; fase_sinds: string
  verantwoordelijke: string | null; briefing: Briefing; briefing_bevestigd_op: string | null; briefing_bevestigd_door: string | null
  tijdscan_op: string | null; tijdscan_notities: string | null; plan_uurtarief: number | null; plan_prijs: number | null
  plan_goedgekeurd_op: string | null; plan_goedgekeurd_door: string | null; review_dag: number | null; review_uur: string | null
  review_reeks_id: string | null; acties: Actiepunt[]; created_at: string
}

const getal = (v: unknown) => (v === null || v === undefined ? null : Number(v))
function naarProject(r: Record<string, unknown>): Project {
  return {
    id: String(r.id), deal_id: (r.deal_id as string | null) ?? null, client_id: (r.client_id as string | null) ?? null, titel: String(r.titel ?? ''),
    fase: isProjectFase(r.fase) ? r.fase : 'briefing', fase_sinds: String(r.fase_sinds ?? r.created_at), verantwoordelijke: (r.verantwoordelijke as string | null) ?? null,
    briefing: netteBriefing(r.briefing), briefing_bevestigd_op: (r.briefing_bevestigd_op as string | null) ?? null, briefing_bevestigd_door: (r.briefing_bevestigd_door as string | null) ?? null,
    tijdscan_op: r.tijdscan_op ? String(r.tijdscan_op).slice(0, 10) : null, tijdscan_notities: (r.tijdscan_notities as string | null) ?? null,
    plan_uurtarief: getal(r.plan_uurtarief), plan_prijs: getal(r.plan_prijs), plan_goedgekeurd_op: (r.plan_goedgekeurd_op as string | null) ?? null,
    plan_goedgekeurd_door: (r.plan_goedgekeurd_door as string | null) ?? null, review_dag: getal(r.review_dag), review_uur: (r.review_uur as string | null) ?? null,
    review_reeks_id: (r.review_reeks_id as string | null) ?? null, acties: Array.isArray(r.acties) ? (r.acties as Actiepunt[]) : [], created_at: String(r.created_at),
  }
}
function naarStory(r: Record<string, unknown>): UserStory {
  return {
    id: String(r.id), project_id: String(r.project_id), nummer: Number(r.nummer), titel: String(r.titel ?? ''), als: String(r.als ?? ''), wil: String(r.wil ?? ''), zodat: String(r.zodat ?? ''),
    acceptatiecriteria: Array.isArray(r.acceptatiecriteria) ? (r.acceptatiecriteria as string[]) : [], schatting_uren: getal(r.schatting_uren), bestede_uren: Number(r.bestede_uren ?? 0),
    status: isStoryStatus(r.status) ? r.status : 'voorstel', dod: netteDod(r.dod), klant_akkoord_op: (r.klant_akkoord_op as string | null) ?? null,
    klant_akkoord_door: (r.klant_akkoord_door as string | null) ?? null, volgorde: Number(r.volgorde ?? 0),
  }
}
function naarCare(r: Record<string, unknown>): CareItem {
  return {
    id: String(r.id), client_id: (r.client_id as string | null) ?? null, project_id: (r.project_id as string | null) ?? null, naam: String(r.naam ?? ''),
    omschrijving: (r.omschrijving as string | null) ?? null, systemen: Array.isArray(r.systemen) ? (r.systemen as string[]) : [], status: (['actief', 'gepauzeerd', 'gestopt'].includes(String(r.status)) ? r.status : 'actief') as CareItem['status'],
    care_contract: r.care_contract === true, maandbedrag: getal(r.maandbedrag), controle_elke_dagen: getal(r.controle_elke_dagen),
    laatste_controle: r.laatste_controle ? String(r.laatste_controle).slice(0, 10) : null, notitie: (r.notitie as string | null) ?? null,
  }
}

async function tijdlijn(admin: Admin, dealId: string | null, tekst: string, door: string | null) {
  if (!dealId) return
  await admin.from('ngs_deal_notities').insert({ deal_id: dealId, tekst, soort: 'systeem', door })
}

async function klantNamen(admin: Admin, ids: (string | null)[]): Promise<Record<string, string>> {
  const uniek = [...new Set(ids.filter((x): x is string => !!x))]
  if (!uniek.length) return {}
  const { data } = await admin.from('clients').select('id, company_name').in('id', uniek)
  return Object.fromEntries(((data ?? []) as { id: string; company_name: string }[]).map((c) => [c.id, c.company_name]))
}

// ── Overzicht ────────────────────────────────────────────────────────────────

export type ProjectKort = Project & { stories: { totaal: number; klaar: number; voorstel: number; geschat: number; besteed: number }; klant: string | null; planTeLaat: number | null }
export type LeveringData = { projecten: ProjectKort[]; care: (CareItem & { klant: string | null; volgende: string | null; teLaat: number | null })[]; klaar: boolean }

export async function laadLevering(admin: Admin, opties: { klant?: string } = {}): Promise<LeveringData> {
  let pq = admin.from('ngs_projecten').select('*').is('gearchiveerd_op', null).order('created_at', { ascending: false }).limit(500)
  let cq = admin.from('ngs_care').select('*').is('gearchiveerd_op', null).order('naam', { ascending: true }).limit(1000)
  if (opties.klant) { pq = pq.eq('client_id', opties.klant); cq = cq.eq('client_id', opties.klant) }
  const [{ data: p, error }, { data: c }] = await Promise.all([pq, cq])
  if (error) return { projecten: [], care: [], klaar: false }
  const projecten = ((p ?? []) as Record<string, unknown>[]).map(naarProject)
  const { data: s } = projecten.length ? await admin.from('ngs_user_stories').select('project_id, status, schatting_uren, bestede_uren').in('project_id', projecten.map((x) => x.id)).is('verwijderd_op', null) : { data: [] }
  const per = new Map<string, ProjectKort['stories']>()
  for (const r of (s ?? []) as { project_id: string; status: string; schatting_uren: number | null; bestede_uren: number | null }[]) {
    const v = per.get(r.project_id) ?? { totaal: 0, klaar: 0, voorstel: 0, geschat: 0, besteed: 0 }
    v.totaal++; if (r.status === 'klaar') v.klaar++; if (r.status === 'voorstel') v.voorstel++
    if (r.status !== 'voorstel') { v.geschat += Number(r.schatting_uren ?? 0); v.besteed += Number(r.bestede_uren ?? 0) }
    per.set(r.project_id, v)
  }
  const care = ((c ?? []) as Record<string, unknown>[]).map(naarCare)
  const namen = await klantNamen(admin, [...projecten.map((x) => x.client_id), ...care.map((x) => x.client_id)])
  const d = vandaag()
  return {
    klaar: true,
    projecten: projecten.map((x) => ({ ...x, stories: per.get(x.id) ?? { totaal: 0, klaar: 0, voorstel: 0, geschat: 0, besteed: 0 }, klant: x.client_id ? namen[x.client_id] ?? null : null, planTeLaat: planTeLaat(x, d) })),
    care: care.map((x) => { const v = volgendeControle(x, d); return { ...x, klant: x.client_id ? namen[x.client_id] ?? null : null, volgende: v.op, teLaat: v.teLaat } }),
  }
}

export type ProjectDetail = { project: Project; stories: UserStory[]; klant: string | null; deal: { id: string; bedrijf: string; fase: string } | null; care: CareItem[] }

export async function projectDetail(admin: Admin, idIn: unknown): Promise<ProjectDetail> {
  const id = moetId(idIn)
  const { data } = await admin.from('ngs_projecten').select('*').eq('id', id).is('gearchiveerd_op', null).maybeSingle()
  if (!data) throw new LeveringFout('Project niet gevonden.', 404)
  const project = naarProject(data as Record<string, unknown>)
  const [{ data: s }, { data: d }, { data: c }, namen] = await Promise.all([
    admin.from('ngs_user_stories').select('*').eq('project_id', id).is('verwijderd_op', null).order('volgorde', { ascending: true }).order('nummer', { ascending: true }),
    project.deal_id ? admin.from('ngs_deals').select('id, bedrijf, fase').eq('id', project.deal_id).maybeSingle() : Promise.resolve({ data: null }),
    admin.from('ngs_care').select('*').eq('project_id', id).is('gearchiveerd_op', null),
    klantNamen(admin, [project.client_id]),
  ])
  return {
    project, stories: ((s ?? []) as Record<string, unknown>[]).map(naarStory), klant: project.client_id ? namen[project.client_id] ?? null : null,
    deal: (d as { id: string; bedrijf: string; fase: string } | null) ?? null, care: ((c ?? []) as Record<string, unknown>[]).map(naarCare),
  }
}

async function leesProject(admin: Admin, id: unknown): Promise<Project> {
  const { data } = await admin.from('ngs_projecten').select('*').eq('id', moetId(id)).is('gearchiveerd_op', null).maybeSingle()
  if (!data) throw new LeveringFout('Project niet gevonden.', 404)
  return naarProject(data as Record<string, unknown>)
}
async function zetProject(admin: Admin, id: string, patch: Record<string, unknown>) {
  const { error } = await admin.from('ngs_projecten').update({ ...patch, updated_at: nu() }).eq('id', id)
  if (error) throw new Error(error.message)
}

// ── Deal: klant koppelen en project starten ─────────────────────────────────

/** Een deal aan een klant koppelen (of loskoppelen). Het project van die deal volgt als het nog geen klant had. */
export async function dealKlant(admin: Admin, dealIdIn: unknown, clientIdIn: unknown, door: string | null): Promise<void> {
  const dealId = moetId(dealIdIn, 'Deal')
  const clientId = clientIdIn === null ? null : moetId(clientIdIn, 'Klant')
  const { data: deal } = await admin.from('ngs_deals').select('id, client_id').eq('id', dealId).is('verwijderd_op', null).maybeSingle()
  if (!deal) throw new LeveringFout('Deal niet gevonden.', 404)
  let naam: string | null = null
  if (clientId) {
    const { data: k } = await admin.from('clients').select('company_name').eq('id', clientId).maybeSingle()
    if (!k) throw new LeveringFout('Klant niet gevonden.', 404)
    naam = (k as { company_name: string }).company_name
  }
  const { error } = await admin.from('ngs_deals').update({ client_id: clientId, updated_at: nu() }).eq('id', dealId)
  if (error) throw new Error(/client_id/.test(error.message) ? 'De koppeling met klanten is er pas na de update van de databank.' : error.message)
  if (clientId) await admin.from('ngs_projecten').update({ client_id: clientId, updated_at: nu() }).eq('deal_id', dealId).is('client_id', null)
  await tijdlijn(admin, dealId, clientId ? `Gekoppeld aan klant ${naam}` : 'Losgekoppeld van de klant', door)
}

/** Na Closed Won: het leveringsproject starten (bestaat het al, dan dat). */
export async function projectStarten(admin: Admin, dealIdIn: unknown, door: string | null): Promise<string> {
  const dealId = moetId(dealIdIn, 'Deal')
  const { data: al } = await admin.from('ngs_projecten').select('id').eq('deal_id', dealId).is('gearchiveerd_op', null).maybeSingle()
  if (al) return (al as { id: string }).id
  const { data: deal } = await admin.from('ngs_deals').select('id, bedrijf, fase, client_id, verantwoordelijke').eq('id', dealId).is('verwijderd_op', null).maybeSingle()
  if (!deal) throw new LeveringFout('Deal niet gevonden.', 404)
  const d = deal as { id: string; bedrijf: string; fase: string; client_id: string | null; verantwoordelijke: string | null }
  if (d.fase !== 'won') throw new LeveringFout('Een leveringsproject start pas na Closed Won.')
  const { data, error } = await admin.from('ngs_projecten').insert({
    deal_id: d.id, client_id: d.client_id, titel: d.bedrijf, verantwoordelijke: d.verantwoordelijke, tijdscan_notities: TIJDSCAN_SJABLOON, created_by: door,
  }).select('id').single()
  if (error || !data) {
    // Twee klikken tegelijk: de unieke index laat er één door.
    const { data: nog } = await admin.from('ngs_projecten').select('id').eq('deal_id', dealId).is('gearchiveerd_op', null).maybeSingle()
    if (nog) return (nog as { id: string }).id
    throw new Error(error?.message ?? 'Project starten mislukt')
  }
  await tijdlijn(admin, d.id, 'Leveringsproject gestart (Briefing)', door)
  return (data as { id: string }).id
}

/** Het project van een deal (of null), voor het dealvenster. */
export async function projectVanDeal(admin: Admin, dealId: string): Promise<{ id: string; fase: ProjectFase } | null> {
  if (!UUID.test(dealId)) return null
  const { data } = await admin.from('ngs_projecten').select('id, fase').eq('deal_id', dealId).is('gearchiveerd_op', null).maybeSingle()
  return (data as { id: string; fase: ProjectFase } | null) ?? null
}

// ── Project ──────────────────────────────────────────────────────────────────

export async function wijzigProject(admin: Admin, idIn: unknown, b: Record<string, unknown>, door: string | null): Promise<void> {
  const p = await leesProject(admin, idIn)
  const patch: Record<string, unknown> = {}
  if (typeof b.titel === 'string' && b.titel.trim()) patch.titel = b.titel.trim().slice(0, 160)
  if (typeof b.verantwoordelijke === 'string') patch.verantwoordelijke = b.verantwoordelijke.trim().slice(0, 80) || null
  if ('briefing' in b) {
    const nieuw = netteBriefing(b.briefing)
    patch.briefing = nieuw
    // Een bevestigde briefing die inhoudelijk verandert, moet opnieuw bevestigd worden.
    if (p.briefing_bevestigd_op && JSON.stringify(nieuw) !== JSON.stringify(p.briefing)) { patch.briefing_bevestigd_op = null; patch.briefing_bevestigd_door = null }
  }
  if ('tijdscan_op' in b) patch.tijdscan_op = typeof b.tijdscan_op === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.tijdscan_op) ? b.tijdscan_op : null
  if (typeof b.tijdscan_notities === 'string') patch.tijdscan_notities = b.tijdscan_notities.replace(/\r\n/g, '\n').slice(0, 20000)
  if ('plan_uurtarief' in b) {
    const t = b.plan_uurtarief === null || String(b.plan_uurtarief).trim() === '' ? null : Number(String(b.plan_uurtarief).replace(',', '.'))
    if (t !== null && (!Number.isFinite(t) || t < 0 || t > 1000)) throw new LeveringFout('Het uurtarief is geen geldig bedrag.')
    patch.plan_uurtarief = t
  }
  if ('client_id' in b) patch.client_id = b.client_id === null ? null : moetId(b.client_id, 'Klant')
  if (!Object.keys(patch).length) return
  await zetProject(admin, p.id, patch)
  if ('tijdscan_op' in patch && patch.tijdscan_op && patch.tijdscan_op !== p.tijdscan_op) await tijdlijn(admin, p.deal_id, `Tijdscan op ${patch.tijdscan_op}`, door)
}

export async function bevestigBriefing(admin: Admin, idIn: unknown, door: string | null): Promise<void> {
  const p = await leesProject(admin, idIn)
  const mist = briefingOntbreekt(p.briefing)
  if (mist.length) throw new LeveringFout(`Vul eerst in: ${mist.join(', ').toLowerCase()}.`)
  await zetProject(admin, p.id, { briefing_bevestigd_op: nu(), briefing_bevestigd_door: door, ...(p.fase === 'briefing' ? { fase: 'user_stories', fase_sinds: nu() } : {}) })
  await tijdlijn(admin, p.deal_id, 'Briefing bevestigd', door)
}

export async function naarFase(admin: Admin, idIn: unknown, naarIn: unknown, door: string | null): Promise<void> {
  const p = await leesProject(admin, idIn)
  if (!isProjectFase(naarIn)) throw new LeveringFout('Onbekende fase.')
  if (naarIn === p.fase) return
  const { stories } = await projectDetail(admin, p.id)
  const fout = waaromNietNaar(p, naarIn, stories)
  if (fout) throw new LeveringFout(fout)
  await zetProject(admin, p.id, { fase: naarIn, fase_sinds: nu() })
  await tijdlijn(admin, p.deal_id, `Levering: ${projectFaseLabel(p.fase)} → ${projectFaseLabel(naarIn)}`, door)
}

/** Het plan met vaste prijs is door de klant goedgekeurd (de prijs komt uit de stories of wordt overschreven). */
export async function keurPlanGoed(admin: Admin, idIn: unknown, prijsIn: unknown, door: string | null): Promise<number> {
  const p = await leesProject(admin, idIn)
  const { stories } = await projectDetail(admin, p.id)
  const plan = planUitStories(stories, p.plan_uurtarief)
  if (!plan.stories) throw new LeveringFout('Keur eerst minstens één user story goed.')
  const prijs = prijsIn === null || prijsIn === undefined || String(prijsIn).trim() === '' ? plan.prijs : Number(String(prijsIn).replace(',', '.'))
  if (prijs === null || !Number.isFinite(prijs) || prijs <= 0) throw new LeveringFout('Vul de vaste prijs in, of een uurtarief om ze uit te rekenen.')
  await zetProject(admin, p.id, { plan_prijs: Math.round(prijs * 100) / 100, plan_goedgekeurd_op: nu(), plan_goedgekeurd_door: door, ...(['briefing', 'user_stories', 'akkoord'].includes(p.fase) ? { fase: 'bouw', fase_sinds: nu() } : {}) })
  await tijdlijn(admin, p.deal_id, `Plan goedgekeurd: ${eur(prijs)} vaste prijs (${plan.stories} user stories, ${plan.uren} uur)`, door)
  return prijs
}

export async function planTerug(admin: Admin, idIn: unknown, door: string | null): Promise<void> {
  const p = await leesProject(admin, idIn)
  await zetProject(admin, p.id, { plan_goedgekeurd_op: null, plan_goedgekeurd_door: null })
  await tijdlijn(admin, p.deal_id, 'Goedkeuring van het plan teruggezet', door)
}

export async function archiveerProject(admin: Admin, idIn: unknown, door: string | null): Promise<void> {
  const p = await leesProject(admin, idIn)
  await zetProject(admin, p.id, { gearchiveerd_op: nu() })
  await tijdlijn(admin, p.deal_id, 'Leveringsproject gearchiveerd', door)
}

// ── User stories ─────────────────────────────────────────────────────────────

async function leesStory(admin: Admin, projectId: string, idIn: unknown): Promise<UserStory> {
  const { data } = await admin.from('ngs_user_stories').select('*').eq('id', moetId(idIn, 'User story')).eq('project_id', projectId).is('verwijderd_op', null).maybeSingle()
  if (!data) throw new LeveringFout('User story niet gevonden.', 404)
  return naarStory(data as Record<string, unknown>)
}

/** Nieuwe stories (één of een hele lijst uit het AI-voorstel). Ze starten als voorstel; nummers lopen door. */
export async function voegStoriesToe(admin: Admin, projectIdIn: unknown, lijst: StoryInvoer[], status: 'voorstel' | 'goedgekeurd' = 'voorstel'): Promise<number> {
  const p = await leesProject(admin, projectIdIn)
  if (!p.briefing_bevestigd_op) throw new LeveringFout('Bevestig eerst de briefing: zonder briefing geen user stories.')
  if (!lijst.length) return 0
  const { data: max } = await admin.from('ngs_user_stories').select('nummer').eq('project_id', p.id).order('nummer', { ascending: false }).limit(1)
  let nr = ((max ?? [])[0] as { nummer: number } | undefined)?.nummer ?? 0
  const rijen = lijst.map((s) => { nr++; return { project_id: p.id, nummer: nr, volgorde: nr, ...s, status, dod: nieuweDod() } })
  const { error } = await admin.from('ngs_user_stories').insert(rijen)
  if (error) throw new Error(error.message)
  return rijen.length
}

export async function wijzigStory(admin: Admin, projectIdIn: unknown, idIn: unknown, b: Record<string, unknown>, door: string | null): Promise<void> {
  const p = await leesProject(admin, projectIdIn)
  const s = await leesStory(admin, p.id, idIn)
  const patch: Record<string, unknown> = { updated_at: nu() }
  if (b.velden && typeof b.velden === 'object') {
    const c = controleerStory(b.velden as Record<string, unknown>)
    if (!c.ok) throw new LeveringFout(c.fout)
    Object.assign(patch, c.story)
  }
  if ('status' in b) {
    if (!isStoryStatus(b.status)) throw new LeveringFout('Onbekende status.')
    if (b.status === 'klaar') { const f = waaromNietKlaar({ dod: s.dod, acceptatiecriteria: (patch.acceptatiecriteria as string[] | undefined) ?? s.acceptatiecriteria }); if (f) throw new LeveringFout(f) }
    patch.status = b.status
  }
  if (Array.isArray(b.dod)) patch.dod = netteDod(b.dod)
  if ('bestede_uren' in b) {
    const u = Number(String(b.bestede_uren).replace(',', '.'))
    if (!Number.isFinite(u) || u < 0 || u > 5000) throw new LeveringFout('Bestede uren: een getal.')
    patch.bestede_uren = Math.round(u * 4) / 4
  }
  if ('klant_akkoord' in b) { patch.klant_akkoord_op = b.klant_akkoord === true ? nu() : null; patch.klant_akkoord_door = b.klant_akkoord === true ? door : null }
  const { error } = await admin.from('ngs_user_stories').update(patch).eq('id', s.id)
  if (error) throw new Error(error.message)
  if ('status' in patch && patch.status !== s.status) await tijdlijn(admin, p.deal_id, `User story ${s.nummer} (${s.titel}): ${storyStatusLabel(s.status)} → ${storyStatusLabel(String(patch.status))}`, door)
  if (b.klant_akkoord === true && !s.klant_akkoord_op) await tijdlijn(admin, p.deal_id, `Klant keurde user story ${s.nummer} goed (${s.titel})`, door)
}

/** Een story weghalen = archiveren (de rij blijft). */
export async function archiveerStory(admin: Admin, projectIdIn: unknown, idIn: unknown): Promise<void> {
  const p = await leesProject(admin, projectIdIn)
  const s = await leesStory(admin, p.id, idIn)
  await admin.from('ngs_user_stories').update({ verwijderd_op: nu() }).eq('id', s.id)
}

// ── Wekelijkse review ────────────────────────────────────────────────────────

/**
 * De wekelijkse review (30 min) als herhalende afspraak in de agenda van wie
 * klikt. Enkel op die klik: de app plant zelf niets in.
 */
export async function planReview(admin: Admin, idIn: unknown, b: Record<string, unknown>, userId: string): Promise<void> {
  const p = await leesProject(admin, idIn)
  if (p.review_reeks_id) throw new LeveringFout('De wekelijkse review staat al in de agenda.')
  const { data: persoon } = await admin.from('ag_personen').select('id').eq('user_id', userId).maybeSingle()
  if (!persoon) throw new LeveringFout('Je hebt nog geen plaats in de agenda (koppel eerst ClickUp of open de agenda één keer).')
  const dag = Number(b.dag), uur = String(b.uur ?? '')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(uur)) throw new LeveringFout('Kies een uur als 10:00.')
  const [h, m] = uur.split(':').map(Number)
  const tot = `${String(Math.floor((h * 60 + m + 30) / 60) % 24).padStart(2, '0')}:${String((m + 30) % 60).padStart(2, '0')}`
  const c = controleerReeks({ soort: 'afspraak', titel: `Weekreview – ${p.titel}`, dagen: [dag], interval_weken: 1, van: uur, tot, start_datum: vandaag(), personen: [(persoon as { id: string }).id] })
  if (!c.ok) throw new LeveringFout(c.fout)
  const { data, error } = await admin.from('ag_reeksen').insert({ ...c.reeks, uitzonderingen: [], eigenaar_id: (persoon as { id: string }).id }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Inplannen mislukt')
  await zetProject(admin, p.id, { review_dag: dag, review_uur: uur, review_reeks_id: (data as { id: string }).id })
  await tijdlijn(admin, p.deal_id, `Wekelijkse review ingepland (${['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'][dag - 1] ?? ''} ${uur})`, null)
}

/** Reviewnotities worden actiepunten op het project. */
export async function actiesUitReview(admin: Admin, idIn: unknown, notities: unknown, door: string | null): Promise<number> {
  const p = await leesProject(admin, idIn)
  const punten = actiepuntenUit(String(notities ?? ''))
  if (!punten.length) throw new LeveringFout('Geen actiepunten gevonden. Zet elk actiepunt op een eigen regel.')
  const datum = vandaag()
  const nieuw: Actiepunt[] = punten.map((tekst) => ({ id: crypto.randomUUID(), tekst, wie: door, tegen: null, gedaan_op: null, uit_review: datum }))
  await zetProject(admin, p.id, { acties: [...p.acties, ...nieuw] })
  await tijdlijn(admin, p.deal_id, `Review ${datum}: ${nieuw.length} actiepunt${nieuw.length === 1 ? '' : 'en'}`, door)
  return nieuw.length
}

export async function zetActie(admin: Admin, idIn: unknown, actieId: unknown, b: Record<string, unknown>): Promise<void> {
  const p = await leesProject(admin, idIn)
  const acties = p.acties.map((a) => {
    if (a.id !== actieId) return a
    const x = { ...a }
    if ('gedaan' in b) x.gedaan_op = b.gedaan === true ? nu() : null
    if (typeof b.wie === 'string') x.wie = b.wie.trim().slice(0, 80) || null
    if ('tegen' in b) x.tegen = typeof b.tegen === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.tegen) ? b.tegen : null
    return x
  })
  await zetProject(admin, p.id, { acties })
}

// ── Care ─────────────────────────────────────────────────────────────────────

export async function bewaarCare(admin: Admin, b: Record<string, unknown>, door: string | null): Promise<string> {
  const c = controleerCare(b)
  if (!c.ok) throw new LeveringFout(c.fout)
  if (typeof b.id === 'string' && UUID.test(b.id)) {
    const { error } = await admin.from('ngs_care').update({ ...c.care, updated_at: nu() }).eq('id', b.id).is('gearchiveerd_op', null)
    if (error) throw new Error(error.message)
    return b.id
  }
  const { data, error } = await admin.from('ngs_care').insert({ ...c.care, created_by: door }).select('id').single()
  if (error || !data) throw new Error(error?.message ?? 'Bewaren mislukt')
  return (data as { id: string }).id
}

export async function careGecontroleerd(admin: Admin, idIn: unknown): Promise<void> {
  const { error } = await admin.from('ngs_care').update({ laatste_controle: vandaag(), updated_at: nu() }).eq('id', moetId(idIn, 'Care')).is('gearchiveerd_op', null)
  if (error) throw new Error(error.message)
}

export async function archiveerCare(admin: Admin, idIn: unknown): Promise<void> {
  const { error } = await admin.from('ngs_care').update({ gearchiveerd_op: nu() }).eq('id', moetId(idIn, 'Care'))
  if (error) throw new Error(error.message)
}

// ── Klantfiche en meldingen ─────────────────────────────────────────────────

export type KlantSolutions = { deals: { id: string; bedrijf: string; fase: string; gewonnen_op: string | null }[]; projecten: ProjectKort[]; care: LeveringData['care'] }

/** Alles van NextGenSolutions bij één klant (voor de klantfiche). Leeg = niets tonen. */
export async function klantSolutions(admin: Admin, clientIdIn: unknown): Promise<KlantSolutions> {
  const clientId = moetId(clientIdIn, 'Klant')
  const [{ data: deals }, levering] = await Promise.all([
    admin.from('ngs_deals').select('id, bedrijf, fase, gewonnen_op').eq('client_id', clientId).is('verwijderd_op', null).order('created_at', { ascending: false }),
    laadLevering(admin, { klant: clientId }),
  ])
  return { deals: (deals ?? []) as KlantSolutions['deals'], projecten: levering.projecten, care: levering.care }
}

/** Voor het belletje: geen plan 5 dagen na de tijdscan, en Care-controles die te laat zijn. */
export async function leveringMeldingen(admin: Admin): Promise<{ id: string; titel: string; href: string; hoog: boolean; datum: string }[]> {
  const l = await laadLevering(admin)
  const d = vandaag()
  const uit: { id: string; titel: string; href: string; hoog: boolean; datum: string }[] = []
  for (const p of l.projecten) if (p.planTeLaat) uit.push({ id: `ngs-plan:${p.id}:${p.tijdscan_op}`, titel: `${p.titel}: ${p.planTeLaat} dagen na de tijdscan nog geen goedgekeurd plan`, href: `/admin/nextgensolutions/levering?project=${p.id}`, hoog: p.planTeLaat > 10, datum: d })
  for (const c of l.care) if (c.teLaat !== null && c.teLaat > 0) uit.push({ id: `ngs-care:${c.id}:${c.volgende}`, titel: `Care-controle ${c.teLaat} dag${c.teLaat === 1 ? '' : 'en'} te laat: ${c.naam}${c.klant ? ` (${c.klant})` : ''}`, href: '/admin/nextgensolutions/levering?tab=care', hoog: c.teLaat > 14, datum: d })
  return uit
}

/** Wat er voor NextGenSolutions gefactureerd is (facturen met bedrijf Solutions, niet geannuleerd): datum + bedrag excl. btw. */
export async function gefactureerdSolutions(admin: Admin): Promise<{ maand: string; bedrag: number; verstuurd: boolean }[]> {
  const { data, error } = await admin.from('invoices').select('invoice_date, invoice_month, amount_excl, status, cancelled_at').eq('bedrijf', 'nextgensolutions').is('cancelled_at', null).limit(5000)
  if (error) return []
  return ((data ?? []) as { invoice_date: string | null; invoice_month: string | null; amount_excl: number | null; status: string }[])
    .map((r) => ({ maand: String(r.invoice_date ?? r.invoice_month ?? '').slice(0, 7), bedrag: Number(r.amount_excl ?? 0), verstuurd: r.status === 'verstuurd' || r.status === 'betaald' }))
    .filter((r) => /^\d{4}-\d{2}$/.test(r.maand))
}
