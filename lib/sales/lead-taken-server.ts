import 'server-only'
import { baseUrl } from '@/lib/email'
import { clickupConfigured, listClickupMembers, maakGewoneTaak, leesTaakStatus, zoekTaakMetMarker, lijstToegang } from '@/lib/clickup'
import { veiligeFout } from '@/lib/meetings/server'
import {
  valideerLeadTaak, leadLink, leadTaakMarker, leadTaakNaam, leadTaakOmschrijving, deadlineMs, merkNaam, type LeadTaakInvoer,
} from '@/lib/sales/lead-taken'

/**
 * Pipeline — taken bij een lead. Eén rij per taak in sales_lead_taken, met de
 * ClickUp-taak ernaast (een gewone taak met deadline, nooit een agenda-item).
 * Aanmaken is veilig te herhalen: dezelfde aanvraag_sleutel geeft dezelfde
 * taak terug, en na een onduidelijke afloop zoeken we de taak eerst terug aan
 * haar referentie voor we een nieuwe maken.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export type LeadTaakRij = {
  id: string; lead_id: string; aanvraag_sleutel: string | null; omschrijving: string; notitie: string | null; deadline: string | null; merk: string
  clickup_list_id: string | null; clickup_assignee_id: number | null; clickup_assignee_naam: string | null
  clickup_task_id: string | null; clickup_url: string | null; clickup_status: string | null; clickup_status_kleur: string | null; clickup_status_type: string | null
  status_gelezen_op: string | null; sync_status: 'wacht' | 'ok' | 'fout'; sync_fout: string | null
  created_by: string | null; created_by_email: string | null; created_at: string; updated_at: string
}

export class LeadTaakFout extends Error {
  constructor(public publiek: string, public status = 400) { super(publiek) }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const nu = () => new Date().toISOString()
const vandaagBrussel = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })

async function bewaar(admin: Admin, id: string, velden: Partial<LeadTaakRij>): Promise<LeadTaakRij> {
  const { data, error } = await admin.from('sales_lead_taken').update({ ...velden, updated_at: nu() }).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  return data as LeadTaakRij
}

const INSTELLING = (naam: string) => `Pipeline → Herinneringsmail → "ClickUp-lijst voor afspraken van ${naam}"`

/** Uitleg als de lijst van een merk ontbreekt of niet bereikbaar is; null = in orde. */
export function lijstProbleem(merk: string, listId: string | null, toegang: 'ok' | 'weg' | 'fout' | null): string | null {
  const naam = merkNaam(merk)
  if (!listId) return `Voor ${naam} is nog geen ClickUp-lijst ingesteld. Kies er een via ${INSTELLING(naam)}.`
  if (toegang === 'weg') return `De ClickUp-lijst van ${naam} is niet bereikbaar voor de ClickUp-koppeling van de app: ze staat in een andere ClickUp-werkruimte of bestaat niet meer. Kies een bereikbare lijst via ${INSTELLING(naam)}, of geef de ClickUp-sleutel van de app toegang tot die werkruimte.`
  return null
}

/** ClickUp-leden om uit te kiezen, en de twee lijsten (ingesteld én bereikbaar?). */
export async function leadTaakOpties(admin: Admin, mijnEmail: string | null = null): Promise<{ ingesteld: boolean; leden: { id: number; naam: string; email: string }[]; lijsten: { merk: string; naam: string; ok: boolean; probleem: string | null }[]; ik: number | null }> {
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
  return {
    ingesteld: clickupConfigured(),
    leden: leden.map((m) => ({ id: m.id, naam: m.username || m.email, email: m.email })).sort((a, b) => a.naam.localeCompare(b.naam)),
    lijsten,
    // Standaard: het ClickUp-lid met hetzelfde e-mailadres als wie de lead open heeft.
    ik: leden.find((m) => !!mijnEmail && m.email.toLowerCase() === mijnEmail.toLowerCase())?.id ?? null,
  }
}

/** De ClickUp-stap van één taak. Werpt nooit: de uitkomst staat op de rij. */
async function stapClickup(admin: Admin, t: LeadTaakRij, lead: { bedrijf: string | null; contact: string | null }): Promise<LeadTaakRij> {
  if (!t.clickup_list_id) return bewaar(admin, t.id, { sync_status: 'fout', sync_fout: lijstProbleem(t.merk, null, null) })
  const marker = leadTaakMarker(t.id)
  try {
    // Al eens geprobeerd en onduidelijk afgelopen? Eerst terugzoeken, nooit een tweede taak.
    if (t.sync_status === 'fout') {
      const al = await zoekTaakMetMarker(t.clickup_list_id, marker, Date.parse(t.created_at)).catch(() => null)
      if (al) {
        const s = await leesTaakStatus(al).catch(() => null)
        return bewaar(admin, t.id, { clickup_task_id: al, clickup_url: s?.url ?? `https://app.clickup.com/t/${al}`, clickup_status: s?.status ?? null, clickup_status_kleur: s?.kleur ?? null, clickup_status_type: s?.type ?? null, status_gelezen_op: nu(), sync_status: 'ok', sync_fout: null })
      }
    }
    const tekst = leadTaakOmschrijving({ link: leadLink(baseUrl(), t.lead_id), bedrijf: lead.bedrijf, contact: lead.contact, notitie: t.notitie, door: t.created_by_email, marker })
    const taak = await maakGewoneTaak(t.clickup_list_id, {
      naam: leadTaakNaam(t.omschrijving, lead.bedrijf), omschrijving: tekst.tekst, markdown: tekst.markdown,
      deadlineMs: t.deadline ? deadlineMs(t.deadline) : null, assigneeId: t.clickup_assignee_id,
    })
    const s = await leesTaakStatus(taak.id).catch(() => null)
    return bewaar(admin, t.id, {
      clickup_task_id: taak.id, clickup_url: taak.url ?? s?.url ?? `https://app.clickup.com/t/${taak.id}`,
      clickup_status: s?.status ?? null, clickup_status_kleur: s?.kleur ?? null, clickup_status_type: s?.type ?? null, status_gelezen_op: s ? nu() : null,
      sync_status: 'ok', sync_fout: null,
    })
  } catch (e) {
    // Lijst in een andere werkruimte of verwijderd: zeg wat er moet gebeuren, niet enkel de ClickUp-code.
    const weg = /→\s*404\b|SHARD_006|Team not authorized|OAUTH_027/.test(veiligeFout(e)) && (await lijstToegang(t.clickup_list_id)) === 'weg'
    return bewaar(admin, t.id, { sync_status: 'fout', sync_fout: weg ? lijstProbleem(t.merk, t.clickup_list_id, 'weg') : veiligeFout(e) })
  }
}

async function leadInfo(admin: Admin, leadId: string): Promise<{ bedrijf: string | null; contact: string | null } | null> {
  const { data } = await admin.from('sales_leads').select('id, sales_companies ( name ), sales_contacts ( name )').eq('id', leadId).maybeSingle()
  if (!data) return null
  const r = data as { sales_companies?: { name?: string | null } | null; sales_contacts?: { name?: string | null } | null }
  return { bedrijf: r.sales_companies?.name ?? null, contact: r.sales_contacts?.name ?? null }
}

/** Nieuwe taak bij een lead: eerst bij ons, dan in ClickUp. Zelfde aanvraag = zelfde taak. */
export async function maakLeadTaak(admin: Admin, leadId: string, b: LeadTaakInvoer & { aanvraag_sleutel?: unknown }, door: { userId: string | null; email: string | null }): Promise<{ taak: LeadTaakRij; herhaald: boolean }> {
  const sleutel = String(b.aanvraag_sleutel ?? '')
  if (!UUID.test(sleutel)) throw new LeadTaakFout('Ongeldige aanvraag. Open het venster opnieuw.')
  const { data: al } = await admin.from('sales_lead_taken').select('*').eq('aanvraag_sleutel', sleutel).maybeSingle()
  if (al) return { taak: al as LeadTaakRij, herhaald: true }

  const v = valideerLeadTaak(b, vandaagBrussel())
  if (!v.ok) throw new LeadTaakFout(v.fout)
  const w = v.waarde
  const lead = await leadInfo(admin, leadId)
  if (!lead) throw new LeadTaakFout('Lead niet gevonden.', 404)
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

  const { data: rij, error } = await admin.from('sales_lead_taken').insert({
    lead_id: leadId, aanvraag_sleutel: sleutel, omschrijving: w.omschrijving, notitie: w.notitie, deadline: w.deadline, merk: w.merk,
    clickup_list_id: (pipe?.clickup_list_id as string | null) ?? null, clickup_assignee_id: lid.id, clickup_assignee_naam: lid.username || lid.email,
    sync_status: 'wacht', created_by: door.userId, created_by_email: door.email,
  }).select('*').single()
  if (error) {
    if (/duplicate|unique|23505/i.test(error.message)) {
      const { data: dubbel } = await admin.from('sales_lead_taken').select('*').eq('aanvraag_sleutel', sleutel).maybeSingle()
      if (dubbel) return { taak: dubbel as LeadTaakRij, herhaald: true }
    }
    throw new Error(error.message)
  }
  const taak = await stapClickup(admin, rij as LeadTaakRij, lead)
  return { taak, herhaald: false }
}

/** Een taak die niet in ClickUp raakte opnieuw proberen (zonder dubbel). */
export async function leadTaakOpnieuw(admin: Admin, leadId: string, taakId: string): Promise<LeadTaakRij> {
  if (!UUID.test(taakId)) throw new LeadTaakFout('Taak niet gevonden.', 404)
  const { data } = await admin.from('sales_lead_taken').select('*').eq('id', taakId).eq('lead_id', leadId).maybeSingle()
  if (!data) throw new LeadTaakFout('Taak niet gevonden.', 404)
  let t = data as LeadTaakRij
  if (t.sync_status === 'ok') return t
  // Intussen een lijst ingesteld voor dit merk? Dan die gebruiken.
  if (!t.clickup_list_id) {
    const { data: pipe } = await admin.from('sales_pipelines').select('clickup_list_id').eq('key', t.merk).maybeSingle()
    if (pipe?.clickup_list_id) t = await bewaar(admin, t.id, { clickup_list_id: pipe.clickup_list_id as string })
  }
  const lead = await leadInfo(admin, leadId)
  return stapClickup(admin, t, lead ?? { bedrijf: null, contact: null })
}

/**
 * De taken van een lead, met hun status zoals ClickUp ze nu toont. Lukt het
 * lezen niet, dan de laatst gekende status en een melding (nooit gegokt).
 */
export async function leadTaken(admin: Admin, leadId: string): Promise<{ taken: LeadTaakRij[]; statusFout: string | null }> {
  const { data, error } = await admin.from('sales_lead_taken').select('*').eq('lead_id', leadId).order('created_at', { ascending: false }).limit(50)
  if (error) throw new Error(error.message)
  const taken = (data ?? []) as LeadTaakRij[]
  let statusFout: string | null = null
  const uit = await Promise.all(taken.map(async (t) => {
    if (!t.clickup_task_id || t.sync_status !== 'ok') return t
    try {
      const s = await leesTaakStatus(t.clickup_task_id)
      if (!s) return t.clickup_status_type === 'weg' ? t : bewaar(admin, t.id, { clickup_status: 'verwijderd', clickup_status_type: 'weg', status_gelezen_op: nu() })
      if (s.status === t.clickup_status && s.type === t.clickup_status_type && s.url === t.clickup_url) return { ...t, status_gelezen_op: nu() }
      return bewaar(admin, t.id, { clickup_status: s.status, clickup_status_kleur: s.kleur, clickup_status_type: s.type, clickup_url: s.url ?? t.clickup_url, status_gelezen_op: nu() })
    } catch (e) {
      statusFout = `Status niet bijgewerkt uit ClickUp (${veiligeFout(e)}). Je ziet de laatst gekende status.`
      return t
    }
  }))
  return { taken: uit, statusFout }
}
