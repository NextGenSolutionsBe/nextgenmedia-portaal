import 'server-only'
import { baseUrl } from '@/lib/email'
import { clickupConfigured, listClickupMembers, maakGewoneTaak, leesTaakStatus, zoekTaakMetMarker, lijstToegang, zetToegewezene, type TaakStatus } from '@/lib/clickup'
import { veiligeFout } from '@/lib/meetings/server'
import {
  valideerLeadTaak, leadLink, leadTaakMarker, leadTaakNaam, leadTaakOmschrijving, deadlineMs, merkNaam, type LeadTaakInvoer,
  opdrachtLink, opdrachtTaakMarker, opdrachtTaakOmschrijving, kiesClickupLid,
} from '@/lib/sales/lead-taken'

/**
 * Taken bij een lead (pipeline) en bij een opdracht (opdrachtenbord). Eén rij
 * per taak (sales_lead_taken of opdracht_taken), met de ClickUp-taak ernaast:
 * een gewone taak met deadline, nooit een agenda-item, toegewezen aan de
 * verantwoordelijke. Aanmaken is veilig te herhalen: dezelfde aanvraag_sleutel
 * geeft dezelfde taak terug, en na een onduidelijke afloop zoeken we de taak
 * eerst terug aan haar referentie voor we een nieuwe maken.
 *
 * De verantwoordelijke blijft gelijk in beide richtingen: wijzigen in de app
 * zet de toegewezene in ClickUp; wie in ClickUp iemand anders op de taak zet,
 * ziet dat bij het volgende openen ook in de app.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export type TaakRij = {
  id: string; lead_id?: string; opdracht_id?: string; aanvraag_sleutel: string | null; omschrijving: string; notitie: string | null; deadline: string | null; merk: string
  clickup_list_id: string | null; clickup_assignee_id: number | null; clickup_assignee_naam: string | null
  clickup_task_id: string | null; clickup_url: string | null; clickup_status: string | null; clickup_status_kleur: string | null; clickup_status_type: string | null
  status_gelezen_op: string | null; sync_status: 'wacht' | 'ok' | 'fout'; sync_fout: string | null
  created_by: string | null; created_by_email: string | null; created_at: string; updated_at: string
}
export type LeadTaakRij = TaakRij & { lead_id: string }
export type OpdrachtTaakRij = TaakRij & { opdracht_id: string }

/** Waar een taak bij hoort: de tabel, de koppeling en hoe de ClickUp-taak eruitziet. */
type Context = { bedrijf: string | null; contact: string | null; titel: string | null; verantwoordelijke: { email: string | null; naam: string | null } }
type Bron = {
  tabel: 'sales_lead_taken' | 'opdracht_taken'
  kolom: 'lead_id' | 'opdracht_id'
  nietGevonden: string
  info: (admin: Admin, id: string) => Promise<Context | null>
  marker: (taakId: string) => string
  naam: (t: TaakRij, c: Context) => string
  omschrijving: (t: TaakRij, c: Context, marker: string) => { tekst: string; markdown: string }
}

export class LeadTaakFout extends Error {
  constructor(public publiek: string, public status = 400) { super(publiek) }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const nu = () => new Date().toISOString()
const vandaagBrussel = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })

async function bewaarIn(admin: Admin, tabel: Bron['tabel'], id: string, velden: Partial<TaakRij>): Promise<TaakRij> {
  const { data, error } = await admin.from(tabel).update({ ...velden, updated_at: nu() }).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  return data as TaakRij
}

const INSTELLING = (naam: string) => `Pipeline → Herinneringsmail → "ClickUp-lijst voor afspraken van ${naam}"`

/** Uitleg als de lijst van een merk ontbreekt of niet bereikbaar is; null = in orde. */
export function lijstProbleem(merk: string, listId: string | null, toegang: 'ok' | 'weg' | 'fout' | null): string | null {
  const naam = merkNaam(merk)
  if (!listId) return `Voor ${naam} is nog geen ClickUp-lijst ingesteld. Kies er een via ${INSTELLING(naam)}.`
  if (toegang === 'weg') return `De ClickUp-lijst van ${naam} is niet bereikbaar voor de ClickUp-koppeling van de app: ze staat in een andere ClickUp-werkruimte of bestaat niet meer. Kies een bereikbare lijst via ${INSTELLING(naam)}, of geef de ClickUp-sleutel van de app toegang tot die werkruimte.`
  return null
}

/**
 * ClickUp-leden om uit te kiezen, en de twee lijsten (ingesteld én bereikbaar?).
 * `standaard`: de verantwoordelijke van de lead of opdracht (e-mail of naam);
 * lukt dat niet, dan wie het venster open heeft.
 */
export async function leadTaakOpties(admin: Admin, mijnEmail: string | null = null, standaard: { email?: string | null; naam?: string | null } | null = null): Promise<{ ingesteld: boolean; leden: { id: number; naam: string; email: string }[]; lijsten: { merk: string; naam: string; ok: boolean; probleem: string | null }[]; ik: number | null; standaard: number | null }> {
  const [leden, { data: pipes }] = await Promise.all([
    listClickupMembers(),
    admin.from('sales_pipelines').select('key, clickup_list_id'),
  ])
  const p = (pipes ?? []) as { key: string; clickup_list_id: string | null }[]
  const lijsten = await Promise.all(['nextgenmedia', 'nextgensolutions'].map(async (k) => {
    const id = p.find((x) => x.key === k)?.clickup_list_id ?? null
    const probleem = lijstProbleem(k, id, id ? await lijstToegang(id) : null)
    return { merk: k, naam: merkNaam(k), ok: !probleem, probleem }
  }))
  const lijst = leden.map((m) => ({ id: m.id, naam: m.username || m.email, email: m.email })).sort((a, b) => a.naam.localeCompare(b.naam))
  // Standaard: het ClickUp-lid met hetzelfde e-mailadres als wie het venster open heeft.
  const ik = kiesClickupLid(lijst, { email: mijnEmail })
  return {
    ingesteld: clickupConfigured(),
    leden: lijst,
    lijsten,
    ik,
    standaard: (standaard ? kiesClickupLid(lijst, standaard) : null) ?? ik,
  }
}

/** De ClickUp-stap van één taak. Werpt nooit: de uitkomst staat op de rij. */
async function stapClickup(admin: Admin, bron: Bron, t: TaakRij, ctx: Context): Promise<TaakRij> {
  const bewaar = (velden: Partial<TaakRij>) => bewaarIn(admin, bron.tabel, t.id, velden)
  if (!t.clickup_list_id) return bewaar({ sync_status: 'fout', sync_fout: lijstProbleem(t.merk, null, null) })
  const marker = bron.marker(t.id)
  try {
    // Al eens geprobeerd en onduidelijk afgelopen? Eerst terugzoeken, nooit een tweede taak.
    if (t.sync_status === 'fout') {
      const al = await zoekTaakMetMarker(t.clickup_list_id, marker, Date.parse(t.created_at)).catch(() => null)
      if (al) {
        const s = await leesTaakStatus(al).catch(() => null)
        return bewaar({ clickup_task_id: al, clickup_url: s?.url ?? `https://app.clickup.com/t/${al}`, clickup_status: s?.status ?? null, clickup_status_kleur: s?.kleur ?? null, clickup_status_type: s?.type ?? null, status_gelezen_op: nu(), sync_status: 'ok', sync_fout: null })
      }
    }
    const tekst = bron.omschrijving(t, ctx, marker)
    const taak = await maakGewoneTaak(t.clickup_list_id, {
      naam: bron.naam(t, ctx), omschrijving: tekst.tekst, markdown: tekst.markdown,
      deadlineMs: t.deadline ? deadlineMs(t.deadline) : null, assigneeId: t.clickup_assignee_id,
    })
    const s = await leesTaakStatus(taak.id).catch(() => null)
    return bewaar({
      clickup_task_id: taak.id, clickup_url: taak.url ?? s?.url ?? `https://app.clickup.com/t/${taak.id}`,
      clickup_status: s?.status ?? null, clickup_status_kleur: s?.kleur ?? null, clickup_status_type: s?.type ?? null, status_gelezen_op: s ? nu() : null,
      sync_status: 'ok', sync_fout: null,
    })
  } catch (e) {
    // Lijst in een andere werkruimte of verwijderd: zeg wat er moet gebeuren, niet enkel de ClickUp-code.
    const weg = /→\s*404\b|SHARD_006|Team not authorized|OAUTH_027/.test(veiligeFout(e)) && (await lijstToegang(t.clickup_list_id)) === 'weg'
    return bewaar({ sync_status: 'fout', sync_fout: weg ? lijstProbleem(t.merk, t.clickup_list_id, 'weg') : veiligeFout(e) })
  }
}

// ── Bronnen ──────────────────────────────────────────────────────────────────

async function emailVanGebruiker(admin: Admin, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null
  try {
    const auth = (admin as unknown as { auth?: { admin?: { getUserById: (id: string) => Promise<{ data?: { user?: { email?: string | null } | null } }> } } }).auth
    const r = await auth?.admin?.getUserById(userId)
    return r?.data?.user?.email ?? null
  } catch { return null }
}

const LEAD: Bron = {
  tabel: 'sales_lead_taken', kolom: 'lead_id', nietGevonden: 'Lead niet gevonden.',
  async info(admin, leadId) {
    const { data } = await admin.from('sales_leads').select('id, assigned_to, sales_companies ( name ), sales_contacts ( name )').eq('id', leadId).maybeSingle()
    if (!data) return null
    const r = data as { assigned_to?: string | null; sales_companies?: { name?: string | null } | null; sales_contacts?: { name?: string | null } | null }
    return { bedrijf: r.sales_companies?.name ?? null, contact: r.sales_contacts?.name ?? null, titel: null, verantwoordelijke: { email: await emailVanGebruiker(admin, r.assigned_to), naam: null } }
  },
  marker: leadTaakMarker,
  naam: (t, c) => leadTaakNaam(t.omschrijving, c.bedrijf),
  omschrijving: (t, c, marker) => leadTaakOmschrijving({ link: leadLink(baseUrl(), t.lead_id as string), bedrijf: c.bedrijf, contact: c.contact, notitie: t.notitie, door: t.created_by_email, marker }),
}

const OPDRACHT: Bron = {
  tabel: 'opdracht_taken', kolom: 'opdracht_id', nietGevonden: 'Opdracht niet gevonden.',
  async info(admin, opdrachtId) {
    let { data, error } = await admin.from('opdrachten').select('id, titel, client_id, klant_vrij, verantwoordelijke').eq('id', opdrachtId).maybeSingle()
    // Vóór de migratie van de verantwoordelijke: zonder die kolom opnieuw.
    if (error && /verantwoordelijke/i.test(error.message)) ({ data } = await admin.from('opdrachten').select('id, titel, client_id, klant_vrij').eq('id', opdrachtId).maybeSingle())
    if (!data) return null
    const o = data as { titel: string | null; client_id: string | null; klant_vrij: string | null; verantwoordelijke?: string | null }
    let bedrijf = o.klant_vrij ?? null
    let contact: string | null = null
    if (o.client_id) {
      const { data: k } = await admin.from('clients').select('company_name, contact_name').eq('id', o.client_id).maybeSingle()
      bedrijf = (k as { company_name?: string | null } | null)?.company_name ?? bedrijf
      contact = (k as { contact_name?: string | null } | null)?.contact_name ?? null
    }
    return { bedrijf, contact, titel: o.titel ?? null, verantwoordelijke: { email: null, naam: o.verantwoordelijke ?? null } }
  },
  marker: opdrachtTaakMarker,
  naam: (t, c) => leadTaakNaam(t.omschrijving, c.bedrijf),
  omschrijving: (t, c, marker) => opdrachtTaakOmschrijving({ link: opdrachtLink(baseUrl(), t.opdracht_id as string), bedrijf: c.bedrijf, titel: c.titel, contact: c.contact, notitie: t.notitie, door: t.created_by_email, marker }),
}

// ── Algemeen: aanmaken, opnieuw, lezen, verantwoordelijke wijzigen ──────────

async function maakTaak(admin: Admin, bron: Bron, bronId: string, b: LeadTaakInvoer & { aanvraag_sleutel?: unknown }, door: { userId: string | null; email: string | null }): Promise<{ taak: TaakRij; herhaald: boolean }> {
  const sleutel = String(b.aanvraag_sleutel ?? '')
  if (!UUID.test(sleutel)) throw new LeadTaakFout('Ongeldige aanvraag. Open het venster opnieuw.')
  const { data: al } = await admin.from(bron.tabel).select('*').eq('aanvraag_sleutel', sleutel).maybeSingle()
  if (al) return { taak: al as TaakRij, herhaald: true }

  const v = valideerLeadTaak(b, vandaagBrussel())
  if (!v.ok) throw new LeadTaakFout(v.fout)
  const w = v.waarde
  const ctx = await bron.info(admin, bronId)
  if (!ctx) throw new LeadTaakFout(bron.nietGevonden, 404)
  if (!clickupConfigured()) throw new LeadTaakFout('ClickUp is niet gekoppeld (CLICKUP_API_KEY ontbreekt). Er is niets aangemaakt.', 503)

  // Het gekozen lid moet echt in de ClickUp-werkruimte zitten.
  const leden = await listClickupMembers()
  if (!leden.length) throw new LeadTaakFout('De ClickUp-leden konden niet gelezen worden. Probeer het zo opnieuw; er is niets aangemaakt.', 503)
  const lid = leden.find((m) => m.id === w.assigneeId)
  if (!lid) throw new LeadTaakFout('Dit ClickUp-lid bestaat niet (meer). Kies iemand anders.')
  const { data: pipe } = await admin.from('sales_pipelines').select('clickup_list_id').eq('key', w.merk).maybeSingle()
  // Lijst niet ingesteld of niet bereikbaar: niets aanmaken, wel zeggen wat er moet gebeuren.
  const listId = (pipe?.clickup_list_id as string | null) ?? null
  const probleem = lijstProbleem(w.merk, listId, listId ? await lijstToegang(listId) : null)
  if (probleem) throw new LeadTaakFout(probleem)

  const { data: rij, error } = await admin.from(bron.tabel).insert({
    [bron.kolom]: bronId, aanvraag_sleutel: sleutel, omschrijving: w.omschrijving, notitie: w.notitie, deadline: w.deadline, merk: w.merk,
    clickup_list_id: listId, clickup_assignee_id: lid.id, clickup_assignee_naam: lid.username || lid.email,
    sync_status: 'wacht', created_by: door.userId, created_by_email: door.email,
  }).select('*').single()
  if (error) {
    if (/duplicate|unique|23505/i.test(error.message)) {
      const { data: dubbel } = await admin.from(bron.tabel).select('*').eq('aanvraag_sleutel', sleutel).maybeSingle()
      if (dubbel) return { taak: dubbel as TaakRij, herhaald: true }
    }
    if (bron.tabel === 'opdracht_taken' && /opdracht_taken|relation|does not exist|schema cache/i.test(error.message)) {
      throw new LeadTaakFout('Taken bij opdrachten zijn nog niet klaar in de databank (migratie ontbreekt). Er is niets aangemaakt.', 503)
    }
    throw new Error(error.message)
  }
  const taak = await stapClickup(admin, bron, rij as TaakRij, ctx)
  return { taak, herhaald: false }
}

async function taakOpnieuw(admin: Admin, bron: Bron, bronId: string, taakId: string): Promise<TaakRij> {
  if (!UUID.test(taakId)) throw new LeadTaakFout('Taak niet gevonden.', 404)
  const { data } = await admin.from(bron.tabel).select('*').eq('id', taakId).eq(bron.kolom, bronId).maybeSingle()
  if (!data) throw new LeadTaakFout('Taak niet gevonden.', 404)
  let t = data as TaakRij
  if (t.sync_status === 'ok') return t
  // Intussen een lijst ingesteld voor dit merk? Dan die gebruiken.
  if (!t.clickup_list_id) {
    const { data: pipe } = await admin.from('sales_pipelines').select('clickup_list_id').eq('key', t.merk).maybeSingle()
    if (pipe?.clickup_list_id) t = await bewaarIn(admin, bron.tabel, t.id, { clickup_list_id: pipe.clickup_list_id as string })
  }
  const ctx = await bron.info(admin, bronId)
  return stapClickup(admin, bron, t, ctx ?? { bedrijf: null, contact: null, titel: null, verantwoordelijke: { email: null, naam: null } })
}

/** Wat ClickUp nu zegt, op de rij: status en (gewijzigde) verantwoordelijke. */
function verschil(t: TaakRij, s: TaakStatus): Partial<TaakRij> | null {
  const velden: Partial<TaakRij> = {}
  if (s.status !== t.clickup_status || s.type !== t.clickup_status_type || (s.url ?? t.clickup_url) !== t.clickup_url) {
    Object.assign(velden, { clickup_status: s.status, clickup_status_kleur: s.kleur, clickup_status_type: s.type, clickup_url: s.url ?? t.clickup_url })
  }
  // Iemand anders op de taak gezet in ClickUp? Dan is dat de verantwoordelijke.
  const wie = s.toegewezen
  if (wie && wie.length && !wie.some((a) => a.id === Number(t.clickup_assignee_id))) {
    Object.assign(velden, { clickup_assignee_id: wie[0].id, clickup_assignee_naam: wie.map((a) => a.naam).join(', ') })
  } else if (wie && wie.length === 0 && t.clickup_assignee_id) {
    Object.assign(velden, { clickup_assignee_id: null, clickup_assignee_naam: null })
  }
  return Object.keys(velden).length ? velden : null
}

/**
 * De taken van een lead of opdracht, met hun status en verantwoordelijke zoals
 * ClickUp ze nu toont. Lukt het lezen niet, dan de laatst gekende status en een
 * melding (nooit gegokt).
 */
async function takenVan(admin: Admin, bron: Bron, bronId: string): Promise<{ taken: TaakRij[]; statusFout: string | null }> {
  const { data, error } = await admin.from(bron.tabel).select('*').eq(bron.kolom, bronId).order('created_at', { ascending: false }).limit(50)
  if (error) {
    // Vóór de migratie: nog geen taken bij opdrachten, geen fout tonen.
    if (bron.tabel === 'opdracht_taken' && /opdracht_taken|relation|does not exist|schema cache/i.test(error.message)) return { taken: [], statusFout: null }
    throw new Error(error.message)
  }
  const taken = (data ?? []) as TaakRij[]
  let statusFout: string | null = null
  const uit = await Promise.all(taken.map(async (t) => {
    if (!t.clickup_task_id || t.sync_status !== 'ok') return t
    try {
      const s = await leesTaakStatus(t.clickup_task_id)
      if (!s) return t.clickup_status_type === 'weg' ? t : bewaarIn(admin, bron.tabel, t.id, { clickup_status: 'verwijderd', clickup_status_type: 'weg', status_gelezen_op: nu() })
      const v = verschil(t, s)
      if (!v) return { ...t, status_gelezen_op: nu() }
      return bewaarIn(admin, bron.tabel, t.id, { ...v, status_gelezen_op: nu() })
    } catch (e) {
      statusFout = `Status niet bijgewerkt uit ClickUp (${veiligeFout(e)}). Je ziet de laatst gekende status.`
      return t
    }
  }))
  return { taken: uit, statusFout }
}

/** Andere verantwoordelijke: eerst in ClickUp, dan bij ons. Lukt ClickUp niet, dan verandert er niets. */
async function wijzigVerantwoordelijke(admin: Admin, bron: Bron, bronId: string, taakId: string, assigneeId: unknown): Promise<TaakRij> {
  if (!UUID.test(taakId)) throw new LeadTaakFout('Taak niet gevonden.', 404)
  const { data } = await admin.from(bron.tabel).select('*').eq('id', taakId).eq(bron.kolom, bronId).maybeSingle()
  if (!data) throw new LeadTaakFout('Taak niet gevonden.', 404)
  const t = data as TaakRij
  const id = Number(assigneeId)
  if (!Number.isInteger(id) || id <= 0) throw new LeadTaakFout('Kies wie verantwoordelijk is.')
  const leden = await listClickupMembers()
  const lid = leden.find((m) => m.id === id)
  if (!lid) throw new LeadTaakFout('Dit ClickUp-lid bestaat niet (meer). Kies iemand anders.')
  if (t.sync_status === 'ok' && t.clickup_task_id) {
    try { await zetToegewezene(t.clickup_task_id, lid.id) } catch (e) {
      throw new LeadTaakFout(`ClickUp aanpassen lukte niet (${veiligeFout(e)}). Er is niets gewijzigd.`, 502)
    }
  }
  // Nog niet in ClickUp (fout): enkel bij ons; "Opnieuw" maakt de taak dan met deze persoon.
  return bewaarIn(admin, bron.tabel, t.id, { clickup_assignee_id: lid.id, clickup_assignee_naam: lid.username || lid.email })
}

/** Standaard-verantwoordelijke voor het venster "Taak toevoegen". */
async function standaardVoor(admin: Admin, bron: Bron, bronId: string): Promise<{ email?: string | null; naam?: string | null } | null> {
  const ctx = await bron.info(admin, bronId).catch(() => null)
  return ctx?.verantwoordelijke ?? null
}

// ── Leads (pipeline) ─────────────────────────────────────────────────────────

/** Nieuwe taak bij een lead: eerst bij ons, dan in ClickUp. Zelfde aanvraag = zelfde taak. */
export async function maakLeadTaak(admin: Admin, leadId: string, b: LeadTaakInvoer & { aanvraag_sleutel?: unknown }, door: { userId: string | null; email: string | null }): Promise<{ taak: LeadTaakRij; herhaald: boolean }> {
  return maakTaak(admin, LEAD, leadId, b, door) as Promise<{ taak: LeadTaakRij; herhaald: boolean }>
}
/** Een taak die niet in ClickUp raakte opnieuw proberen (zonder dubbel). */
export async function leadTaakOpnieuw(admin: Admin, leadId: string, taakId: string): Promise<LeadTaakRij> {
  return taakOpnieuw(admin, LEAD, leadId, taakId) as Promise<LeadTaakRij>
}
export async function leadTaken(admin: Admin, leadId: string): Promise<{ taken: LeadTaakRij[]; statusFout: string | null }> {
  return takenVan(admin, LEAD, leadId) as Promise<{ taken: LeadTaakRij[]; statusFout: string | null }>
}
export async function leadTaakVerantwoordelijke(admin: Admin, leadId: string, taakId: string, assigneeId: unknown): Promise<LeadTaakRij> {
  return wijzigVerantwoordelijke(admin, LEAD, leadId, taakId, assigneeId) as Promise<LeadTaakRij>
}
export const leadStandaard = (admin: Admin, leadId: string) => standaardVoor(admin, LEAD, leadId)

// ── Opdrachten (opdrachtenbord) ──────────────────────────────────────────────

export async function maakOpdrachtTaak(admin: Admin, opdrachtId: string, b: LeadTaakInvoer & { aanvraag_sleutel?: unknown }, door: { userId: string | null; email: string | null }): Promise<{ taak: OpdrachtTaakRij; herhaald: boolean }> {
  return maakTaak(admin, OPDRACHT, opdrachtId, b, door) as Promise<{ taak: OpdrachtTaakRij; herhaald: boolean }>
}
export async function opdrachtTaakOpnieuw(admin: Admin, opdrachtId: string, taakId: string): Promise<OpdrachtTaakRij> {
  return taakOpnieuw(admin, OPDRACHT, opdrachtId, taakId) as Promise<OpdrachtTaakRij>
}
export async function opdrachtTaken(admin: Admin, opdrachtId: string): Promise<{ taken: OpdrachtTaakRij[]; statusFout: string | null }> {
  return takenVan(admin, OPDRACHT, opdrachtId) as Promise<{ taken: OpdrachtTaakRij[]; statusFout: string | null }>
}
export async function opdrachtTaakVerantwoordelijke(admin: Admin, opdrachtId: string, taakId: string, assigneeId: unknown): Promise<OpdrachtTaakRij> {
  return wijzigVerantwoordelijke(admin, OPDRACHT, opdrachtId, taakId, assigneeId) as Promise<OpdrachtTaakRij>
}
export const opdrachtStandaard = (admin: Admin, opdrachtId: string) => standaardVoor(admin, OPDRACHT, opdrachtId)
