import 'server-only'
import type { createAdminSupabaseClient } from '@/lib/supabase/server'
import {
  controleerDeal, verplaatsing, faseLabel, dealWaarde, isFase, DIENSTEN, type Deal, type TaakKort,
} from '@/lib/ngs/model'

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
  }
}

export type Notitie = { id: string; tekst: string; soort: 'notitie' | 'systeem'; door: string | null; created_at: string }
export type NgsData = { deals: Deal[]; taken: TaakKort[]; ik: string | null; klaar: boolean }

/** Alle deals (niet verwijderd) en de opvolgtaken zoals laatst gekend (voor het bord; live status in het dealvenster). */
export async function laadNgs(admin: Admin, ik: string | null): Promise<NgsData> {
  const { data, error } = await admin.from('ngs_deals').select('*').is('verwijderd_op', null).order('created_at', { ascending: false }).limit(5000)
  if (error) { if (MIST.test(error.message)) return { deals: [], taken: [], ik, klaar: false }; throw new Error(error.message) }
  const { data: t } = await admin.from('ngs_deal_taken').select('deal_id, deadline, afgerond_op, clickup_status_type, sync_status').limit(20000)
  return { deals: ((data ?? []) as Record<string, unknown>[]).map(naarDeal), taken: (t ?? []) as TaakKort[], ik, klaar: true }
}

async function leesDeal(admin: Admin, id: string): Promise<Deal> {
  if (!UUID.test(id)) throw new NgsFout('Deal niet gevonden.', 404)
  const { data } = await admin.from('ngs_deals').select('*').eq('id', id).is('verwijderd_op', null).maybeSingle()
  if (!data) throw new NgsFout('Deal niet gevonden.', 404)
  return naarDeal(data as Record<string, unknown>)
}

export async function notities(admin: Admin, dealId: string): Promise<Notitie[]> {
  if (!UUID.test(dealId)) return []
  const { data } = await admin.from('ngs_deal_notities').select('id, tekst, soort, door, created_at').eq('deal_id', dealId).order('created_at', { ascending: false }).limit(200)
  return (data ?? []) as Notitie[]
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

/** Nieuwe deal; standaard in Afspraak (of de fase die meekomt, behalve won/lost: die gaan via verplaatsen). */
export async function maakDeal(admin: Admin, b: Record<string, unknown>, door: string | null): Promise<string> {
  const v = controleerDeal(b)
  if (!v.ok) throw new NgsFout(v.fout)
  const fase = b.fase === 'voorstel' || b.fase === 'opvolgen' ? b.fase : 'afspraak'
  const { data, error } = await admin.from('ngs_deals').insert({ ...v.waarde, fase, created_by: door }).select('id').single()
  if (error) throw new Error(error.message)
  const id = String((data as { id: string }).id)
  await systeem(admin, id, `Deal aangemaakt in ${faseLabel(fase)}`, door)
  return id
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

/** Naar een andere fase (won met datum, lost met reden), met een regel in de tijdlijn. */
export async function verplaatsDeal(admin: Admin, id: string, b: Record<string, unknown>, door: string | null): Promise<Deal> {
  const oud = await leesDeal(admin, id)
  const v = verplaatsing(oud, b.naar, { datum: b.datum, reden: b.reden }, vandaagBrussel(), new Date().toISOString())
  if (!v.ok) throw new NgsFout(v.fout)
  if (v.patch.fase === oud.fase && v.patch.fase !== 'won' && v.patch.fase !== 'lost') return oud
  const { data, error } = await admin.from('ngs_deals').update({ ...v.patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()
  if (error) throw new Error(error.message)
  const nieuw = naarDeal(data as Record<string, unknown>)
  const extra = nieuw.fase === 'won' ? ` (${eur(dealWaarde(nieuw))})` : nieuw.fase === 'lost' ? `: ${nieuw.verloren_reden}` : ''
  await systeem(admin, id, `${faseLabel(oud.fase)} → ${faseLabel(nieuw.fase)}${extra}`, door)
  return nieuw
}

/** Verwijderen = uit de pipeline en de cijfers (de rij blijft bewaard, voor de zekerheid). */
export async function verwijderDeal(admin: Admin, id: string, door: string | null): Promise<void> {
  await leesDeal(admin, id)
  const { error } = await admin.from('ngs_deals').update({ verwijderd_op: new Date().toISOString(), verwijderd_door: door }).eq('id', id)
  if (error) throw new Error(error.message)
}
