import 'server-only'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import {
  controleerDeal, verplaatsing, faseLabel, dealWaarde, isFase, DIENSTEN, controleerAudit, leesChecklist, isAuditStap, volgendeBelDatum, isOpvolgFase,
  AUDIT_STAPPEN, type Deal, type TaakKort,
} from '@/lib/ngs/model'
import { leesInstellingen } from '@/lib/instellingen/laden'
import { auditPrijs, type WerkingInstellingen } from '@/lib/werking/instellingen'
import { UITKOMSTEN } from '@/lib/abm'

/**
 * NextGenSolutions — eigen pipeline (regels in lib/ngs/model.ts). Los van de
 * rest van de app; enkel de opvolgtaken gaan naar ClickUp (via
 * lib/sales/lead-taken-server.ts, lijst van NextGen Solutions).
 */

type Admin = ReturnType<typeof createAdminSupabaseClient>

export class NgsFout extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

const MIST = /ngs_|does not exist|schema cache/i
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const vandaagBrussel = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const eur = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const getal = (v: unknown) => (v === null || v === undefined ? null : Number(v))

function naarDeal(r: Record<string, unknown>): Deal {
  return {
    id: String(r.id), bedrijf: String(r.bedrijf ?? ''), contactpersoon: (r.contactpersoon as string | null) ?? null, email: (r.email as string | null) ?? null,
    telefoon: (r.telefoon as string | null) ?? null, titel: (r.titel as string | null) ?? null, diensten: Array.isArray(r.diensten) ? (r.diensten as string[]) : [],
    fase: isFase(r.fase) ? r.fase : 'afspraak', fase_sinds: String(r.fase_sinds ?? r.created_at), afspraak_op: (r.afspraak_op as string | null) ?? null,
    waarde_eenmalig: getal(r.waarde_eenmalig), waarde_maandelijks: getal(r.waarde_maandelijks), looptijd_maanden: getal(r.looptijd_maanden),
    start_datum: r.start_datum ? String(r.start_datum).slice(0, 10) : null, bron: (r.bron as string | null) ?? null, verantwoordelijke: (r.verantwoordelijke as string | null) ?? null,
    gewonnen_op: r.gewonnen_op ? String(r.gewonnen_op).slice(0, 10) : null, verloren_op: r.verloren_op ? String(r.verloren_op).slice(0, 10) : null,
    verloren_reden: (r.verloren_reden as string | null) ?? null, created_at: String(r.created_at), created_by: (r.created_by as string | null) ?? null,
    client_id: (r.client_id as string | null) ?? null,
    vervolg_op: (r.vervolg_op as string | null) ?? null, vervolg_meeting_id: (r.vervolg_meeting_id as string | null) ?? null,
    processen: getal(r.processen), audit_prijs: getal(r.audit_prijs), audit_contract_id: (r.audit_contract_id as string | null) ?? null,
    audit_buiten_app: r.audit_buiten_app === true, audit_buiten_notitie: (r.audit_buiten_notitie as string | null) ?? null,
    auditdag_op: r.auditdag_op ? String(r.auditdag_op).slice(0, 10) : null, presentatie_op: r.presentatie_op ? String(r.presentatie_op).slice(0, 10) : null,
    audit_checklist: leesChecklist(r.audit_checklist),
  }
}

export type Notitie = { id: string; tekst: string; soort: 'notitie' | 'systeem'; door: string | null; created_at: string; uitkomst?: string | null }
/** De eerstvolgende meeting per deal (vervolgafspraak uit de Meeting Inplanner). */
export type Vervolg = { id: string; starts_at: string; titel: string | null }
export type NgsData = { deals: Deal[]; taken: TaakKort[]; ik: string | null; klaar: boolean; vervolg: Record<string, Vervolg>; verkoop: WerkingInstellingen['verkoop'] }

/** Alle deals (niet verwijderd) en de opvolgtaken zoals laatst gekend (voor het bord; live status in het dealvenster). */
export async function laadNgs(admin: Admin, ik: string | null): Promise<NgsData> {
  const sinds = new Date(Date.now() - 12 * 3_600_000).toISOString()
  const [{ data, error }, { data: t }, { data: mt }, inst] = await Promise.all([
    admin.from('ngs_deals').select('*').is('verwijderd_op', null).order('created_at', { ascending: false }).limit(5000),
    admin.from('ngs_deal_taken').select('deal_id, deadline, afgerond_op, clickup_status_type, sync_status').limit(20000),
    admin.from('klant_meetings').select('id, ngs_deal_id, starts_at, titel, status').not('ngs_deal_id', 'is', null).neq('status', 'geannuleerd').gte('starts_at', sinds).order('starts_at', { ascending: true }).limit(2000),
    leesInstellingen(),
  ])
  if (error) { if (MIST.test(error.message)) return { deals: [], taken: [], ik, klaar: false, vervolg: {}, verkoop: inst.werking.verkoop }; throw new Error(error.message) }
  const vervolg: Record<string, Vervolg> = {}
  for (const m of (mt ?? []) as { id: string; ngs_deal_id: string; starts_at: string; titel: string | null }[]) if (!vervolg[m.ngs_deal_id]) vervolg[m.ngs_deal_id] = { id: m.id, starts_at: m.starts_at, titel: m.titel }
  return { deals: ((data ?? []) as Record<string, unknown>[]).map(naarDeal), taken: (t ?? []) as TaakKort[], ik, klaar: true, vervolg, verkoop: inst.werking.verkoop }
}

/** Elke verplaatsing in de geschiedenis (trechter en scorecard). Mislukt het, dan geen fout: de deal zelf is al juist. */
async function faseLog(admin: Admin, dealId: string, van: string | null, naar: string, door: string | null) {
  try { await admin.from('ngs_deal_fases').insert({ deal_id: dealId, van, naar, door }) } catch { /* de tijdlijn heeft het ook */ }
}

async function leesDeal(admin: Admin, id: string): Promise<Deal> {
  if (!UUID.test(id)) throw new NgsFout('Deal niet gevonden.', 404)
  const { data } = await admin.from('ngs_deals').select('*').eq('id', id).is('verwijderd_op', null).maybeSingle()
  if (!data) throw new NgsFout('Deal niet gevonden.', 404)
  return naarDeal(data as Record<string, unknown>)
}

export async function notities(admin: Admin, dealId: string): Promise<Notitie[]> {
  if (!UUID.test(dealId)) return []
  const r = await admin.from('ngs_deal_notities').select('id, tekst, soort, door, created_at, uitkomst').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(200)
  if (!r.error) return (r.data ?? []) as Notitie[]
  const oud = await admin.from('ngs_deal_notities').select('id, tekst, soort, door, created_at').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(200)
  return (oud.data ?? []) as Notitie[]
}

async function systeem(admin: Admin, dealId: string, tekst: string, door: string | null) {
  await admin.from('ngs_deal_notities').insert({ deal_id: dealId, tekst, soort: 'systeem', door })
}

export async function voegNotitieToe(admin: Admin, dealId: string, tekstIn: unknown, door: string | null): Promise<void> {
  await leesDeal(admin, dealId)
  const tekst = String(tekstIn ?? '').trim().slice(0, 5000)
  if (!tekst) throw new NgsFout('Schrijf eerst iets.')
  const { error } = await admin.from('ngs_deal_notities').insert({ deal_id: dealId, tekst, soort: 'notitie', door })
  if (error) throw new Error(error.message)
}

/**
 * Nieuwe klant of deal, in elke fase: standaard Afspraak; Closed Won met de
 * datum (bv. een bestaande klant), Closed Lost met de reden. Zelfde regels als verplaatsen.
 */
export async function maakDeal(admin: Admin, b: Record<string, unknown>, door: string | null): Promise<string> {
  const v = controleerDeal(b)
  if (!v.ok) throw new NgsFout(v.fout)
  const fase = isFase(b.fase) ? b.fase : 'afspraak'
  const p = verplaatsing({ start_datum: v.waarde.start_datum }, fase, { datum: b.datum, reden: b.reden }, vandaagBrussel(), new Date().toISOString())
  if (!p.ok) throw new NgsFout(p.fout)
  const { data, error } = await admin.from('ngs_deals').insert({ ...v.waarde, ...p.patch, created_by: door }).select('*').single()
  if (error) throw new Error(error.message)
  const d = naarDeal(data as Record<string, unknown>)
  const extra = d.fase === 'won' ? ` (${eur(dealWaarde(d))})` : d.fase === 'lost' ? `: ${d.verloren_reden}` : ''
  await systeem(admin, d.id, `Toegevoegd in ${faseLabel(fase)}${extra}`, door)
  await faseLog(admin, d.id, null, d.fase, door)
  return d.id
}

export async function wijzigDeal(admin: Admin, id: string, b: Record<string, unknown>, door: string | null): Promise<void> {
  const oud = await leesDeal(admin, id)
  const v = controleerDeal(b)
  if (!v.ok) throw new NgsFout(v.fout)
  const { error } = await admin.from('ngs_deals').update({ ...v.waarde, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
  const nieuweWaarde = dealWaarde(v.waarde), oudeWaarde = dealWaarde(oud)
  if (nieuweWaarde !== oudeWaarde) await systeem(admin, id, `Waarde aangepast: ${eur(oudeWaarde)} → ${eur(nieuweWaarde)}`, door)
  const gewijzigd = DIENSTEN.filter((d) => v.waarde.diensten.includes(d.key) !== oud.diensten.includes(d.key)).length
  if (gewijzigd) await systeem(admin, id, `Diensten: ${v.waarde.diensten.length ? v.waarde.diensten.map((k) => DIENSTEN.find((d) => d.key === k)?.label ?? k).join(', ') : 'geen'}`, door)
}

/**
 * Naar een andere fase (won met datum, lost met reden), met een regel in de tijdlijn.
 * Nieuwe werking: naar Voorstel met de vervolgafspraak (optioneel, anders een gele
 * waarschuwing op de kaart); naar Audit met processen, prijs, getekend voorstel,
 * auditdag en presentatie (verplicht, prijs uit Instellingen → Werking).
 */
export async function verplaatsDeal(admin: Admin, id: string, b: Record<string, unknown>, door: string | null): Promise<{ deal: Deal; waarschuwing: string | null }> {
  const oud = await leesDeal(admin, id)
  const v = verplaatsing(oud, b.naar, { datum: b.datum, reden: b.reden }, vandaagBrussel(), new Date().toISOString())
  if (!v.ok) throw new NgsFout(v.fout)
  if (v.patch.fase === oud.fase && v.patch.fase !== 'won' && v.patch.fase !== 'lost') return { deal: oud, waarschuwing: null }
  const patch: Record<string, unknown> = { ...v.patch }
  let waarschuwing: string | null = null
  let extra = ''
  if (v.patch.fase === 'voorstel' && b.vervolg_op) {
    const t = new Date(String(b.vervolg_op))
    if (Number.isNaN(t.getTime())) throw new NgsFout('De datum van de vervolgafspraak klopt niet.')
    patch.vervolg_op = t.toISOString()
  }
  if (v.patch.fase === 'audit') {
    const w = (await leesInstellingen()).werking.verkoop
    const a = controleerAudit(b, { max_processen: w.max_processen, presentatie_max_dagen: w.presentatie_max_dagen, prijs: (n) => auditPrijs(n, w) })
    if (!a.ok) throw new NgsFout(a.fout)
    // De klant: van het getekende contract, of zoals gekozen, of wat al op de deal stond.
    let klant = typeof b.client_id === 'string' && UUID.test(b.client_id) ? b.client_id : oud.client_id ?? null
    if (a.audit.audit_contract_id) {
      const { data: c } = await admin.from('contracts').select('id, client_id, signed_at').eq('id', a.audit.audit_contract_id).maybeSingle()
      if (!c) throw new NgsFout('Dat contract bestaat niet.', 404)
      if (!c.signed_at) throw new NgsFout('Dat contract is nog niet getekend.')
      klant = c.client_id ?? klant
      await admin.from('contracts').update({ ngs_deal_id: id }).eq('id', c.id).is('ngs_deal_id', null)
    }
    if (!klant) throw new NgsFout('Aan welke klant hangt de audit? Kies of maak de klant.')
    Object.assign(patch, a.audit, { client_id: klant, audit_checklist: leesChecklist(oud.audit_checklist) })
    waarschuwing = a.waarschuwing
    extra = ` (${a.audit.processen} ${a.audit.processen === 1 ? 'proces' : 'processen'}, ${eur(a.audit.audit_prijs)}, auditdag ${a.audit.auditdag_op}, presentatie ${a.audit.presentatie_op})`
  }
  let r = await admin.from('ngs_deals').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
  // Vóór de migratie: zonder de nieuwe kolommen (enkel als er geen audit nodig is).
  if (r.error && /column|schema cache/i.test(r.error.message) && v.patch.fase !== 'audit') r = await admin.from('ngs_deals').update({ ...v.patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
  if (r.error) throw new Error(r.error.message)
  const nieuw = naarDeal(r.data as Record<string, unknown>)
  if (nieuw.fase === 'won') extra = ` (${eur(dealWaarde(nieuw))})`
  if (nieuw.fase === 'lost') extra = `: ${nieuw.verloren_reden}`
  if (nieuw.fase === 'voorstel' && patch.vervolg_op) extra = ` · vervolgafspraak ${new Date(String(patch.vervolg_op)).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
  await systeem(admin, id, `${faseLabel(oud.fase)} → ${faseLabel(nieuw.fase)}${extra}`, door)
  await faseLog(admin, id, oud.fase, nieuw.fase, door)
  return { deal: nieuw, waarschuwing }
}

/** Vervolgafspraak met de hand (bv. al elders vastgelegd); leeg = weghalen. */
export async function zetVervolg(admin: Admin, id: string, waarde: unknown, door: string | null): Promise<void> {
  await leesDeal(admin, id)
  let op: string | null = null
  if (waarde) { const t = new Date(String(waarde)); if (Number.isNaN(t.getTime())) throw new NgsFout('De datum klopt niet.'); op = t.toISOString() }
  const { error } = await admin.from('ngs_deals').update({ vervolg_op: op, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
  await systeem(admin, id, op ? `Vervolgafspraak: ${new Date(op).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : 'Vervolgafspraak weggehaald', door)
}

/**
 * Belpoging gelogd (Opvolgen voorstel of Opvolgen rapport): een notitie met de
 * uitkomst. Geeft het voorstel voor de volgende opvolging terug (standaard 7
 * dagen later, Instellingen → Werking); de taak zelf maakt de mens.
 */
export async function belpoging(admin: Admin, id: string, b: Record<string, unknown>, door: string | null): Promise<{ voorstel: string }> {
  const d = await leesDeal(admin, id)
  const uitkomst = UITKOMSTEN.some((u) => u.key === b.uitkomst) ? String(b.uitkomst) : null
  if (!uitkomst) throw new NgsFout('Hoe ging het gesprek?')
  const tekst = String(b.tekst ?? '').trim().slice(0, 5000)
  const label = UITKOMSTEN.find((u) => u.key === uitkomst)!.label
  let r = await admin.from('ngs_deal_notities').insert({ deal_id: id, tekst: tekst || label, soort: 'notitie', door, uitkomst })
  if (r.error && /uitkomst/.test(r.error.message)) r = await admin.from('ngs_deal_notities').insert({ deal_id: id, tekst: `${label}${tekst ? `: ${tekst}` : ''}`, soort: 'notitie', door })
  if (r.error) throw new Error(r.error.message)
  const w = (await leesInstellingen()).werking.verkoop
  void isOpvolgFase(d.fase)
  return { voorstel: volgendeBelDatum(vandaagBrussel(), w.opvolg_dagen) }
}

/** Een stap van de audit afvinken (of weer open). */
export async function auditStap(admin: Admin, id: string, stap: unknown, aan: unknown, door: string | null): Promise<void> {
  const d = await leesDeal(admin, id)
  if (!isAuditStap(stap)) throw new NgsFout('Onbekende stap.')
  const lijst = { ...leesChecklist(d.audit_checklist), [stap]: aan === true ? new Date().toISOString() : null }
  const { error } = await admin.from('ngs_deals').update({ audit_checklist: lijst, updated_at: new Date().toISOString() }).eq('id', id)
  if (error) throw new Error(error.message)
  const titel = AUDIT_STAPPEN.find((s) => s.key === stap)!.titel
  await systeem(admin, id, `${aan === true ? 'Afgevinkt' : 'Weer open'}: ${titel}`, door)
}

/** De contracten van de klant van de deal, om het getekende voorstel te kiezen. */
export async function contractenVoorDeal(admin: Admin, id: string): Promise<{ id: string; titel: string; getekend: string | null; bedrijf: string | null }[]> {
  const d = await leesDeal(admin, id)
  const of = [`ngs_deal_id.eq.${id}`]
  if (d.client_id) of.push(`client_id.eq.${d.client_id}`)
  const { data } = await admin.from('contracts').select('id, title, signed_at, bedrijf, created_at').or(of.join(',')).order('created_at', { ascending: false }).limit(50)
  return ((data ?? []) as { id: string; title: string | null; signed_at: string | null; bedrijf: string | null }[]).map((c) => ({ id: c.id, titel: c.title ?? 'Contract', getekend: c.signed_at, bedrijf: c.bedrijf }))
}

/** Verwijderen = uit de pipeline en de cijfers (de rij blijft bewaard, voor de zekerheid). */
export async function verwijderDeal(admin: Admin, id: string, door: string | null): Promise<void> {
  await leesDeal(admin, id)
  const { error } = await admin.from('ngs_deals').update({ verwijderd_op: new Date().toISOString(), verwijderd_door: door }).eq('id', id)
  if (error) throw new Error(error.message)
}
