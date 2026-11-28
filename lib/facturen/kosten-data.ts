import 'server-only'
import { normalizeInvoiceStatus, recurringActiveInMonth, type RecurringInvoice } from '@/lib/invoices'
import {
  berekenKostenWinst, telSamen, vermoedelijkeKostenlijn,
  type Lijn, type Kost, type FactuurKostenWinst, type KostenStatus, type Classificatie,
} from './kosten-winst'

/**
 * Databanklaag voor kosten en winst per factuur. Leest lijnen en kosten in
 * bulk en laat de pure kern (kosten-winst.ts) rekenen — dezelfde functie die
 * het scherm gebruikt, dus dezelfde cijfers in Facturen, Vesting, Financiën
 * en de Excel-export.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

export type FactuurRef = { invoice_id: string; recurring_id?: undefined; maand?: undefined } | { recurring_id: string; maand: string; invoice_id?: undefined }
export const rijSleutel = (ref: FactuurRef) => (ref.invoice_id ? `one:${ref.invoice_id}` : `rec:${ref.recurring_id}:${ref.maand}`)

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const nn = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : (Number.isFinite(Number(v)) ? Number(v) : null))

export function naarLijn(r: Record<string, unknown>): Lijn {
  return {
    id: String(r.id), volgnr: n(r.volgnr), omschrijving: String(r.omschrijving ?? ''), aantal: n(r.aantal) || 1, prijs_excl: n(r.prijs_excl), btw_pct: n(r.btw_pct),
    classificatie: (['dienst', 'doorgerekende_kost', 'gemengd'].includes(String(r.classificatie)) ? r.classificatie : 'dienst') as Classificatie, opmerking: (r.opmerking as string | null) ?? null,
  }
}
export function naarKost(r: Record<string, unknown>): Kost {
  return {
    id: String(r.id), line_id: (r.line_id as string | null) ?? null, omschrijving: String(r.omschrijving ?? ''), categorie: (r.categorie as string | null) ?? null,
    leverancier: (r.leverancier as string | null) ?? null, kostprijs_excl: nn(r.kostprijs_excl), datum: r.datum ? String(r.datum).slice(0, 10) : null,
    bewijs_url: (r.bewijs_url as string | null) ?? null, opmerking: (r.opmerking as string | null) ?? null, status: r.status === 'geannuleerd' ? 'geannuleerd' : 'actief',
  }
}

export type FactuurKop = {
  ref: FactuurRef; omzet_excl: number; btw_pct: number; omzet_incl: number | null; omschrijving: string | null
  factuurstatus: string; client_id: string | null; contract_id: string | null; kind: string; bevestigd: boolean; invoice_month: string | null
}

export type FactuurMetKosten = { kop: FactuurKop; lijnen: Lijn[]; kosten: Kost[]; berekend: FactuurKostenWinst }

/**
 * Lijnen, kosten en berekening voor een reeks facturen (eenmalig) en/of
 * recurring maanden, in vier queries — hoeveel rijen er ook zijn.
 */
export async function kostenPerFactuur(admin: Admin, invoiceIds: string[], recurringRefs: { recurring_id: string; maand: string }[]): Promise<Map<string, FactuurMetKosten>> {
  const uit = new Map<string, FactuurMetKosten>()
  const recIds = Array.from(new Set(recurringRefs.map((r) => r.recurring_id)))
  const [inv, rec, lijnen, kostenInv, kostenRec] = await Promise.all([
    invoiceIds.length ? admin.from('invoices').select('id, amount_excl, vat_pct, amount_incl, description, status, client_id, contract_id, kind, invoice_month, geen_directe_kosten_bevestigd_op').in('id', invoiceIds) : Promise.resolve({ data: [] }),
    recIds.length ? admin.from('recurring_invoices').select('id, amount_excl, vat_pct, amount_incl, description, client_id, geen_directe_kosten_bevestigd_op').in('id', recIds) : Promise.resolve({ data: [] }),
    (invoiceIds.length || recIds.length)
      ? admin.from('invoice_lines').select('*').or([invoiceIds.length ? `invoice_id.in.(${invoiceIds.join(',')})` : null, recIds.length ? `recurring_id.in.(${recIds.join(',')})` : null].filter(Boolean).join(',')).order('volgnr')
      : Promise.resolve({ data: [] }),
    invoiceIds.length ? admin.from('invoice_costs').select('*').in('invoice_id', invoiceIds).order('created_at') : Promise.resolve({ data: [] }),
    recIds.length ? admin.from('invoice_costs').select('*').in('recurring_id', recIds).order('created_at') : Promise.resolve({ data: [] }),
  ])
  const lijnenPerInv = new Map<string, Lijn[]>(); const lijnenPerRec = new Map<string, Lijn[]>()
  for (const r of (lijnen.data ?? []) as Record<string, unknown>[]) {
    const l = naarLijn(r)
    if (r.invoice_id) lijnenPerInv.set(String(r.invoice_id), [...(lijnenPerInv.get(String(r.invoice_id)) ?? []), l])
    else if (r.recurring_id) lijnenPerRec.set(String(r.recurring_id), [...(lijnenPerRec.get(String(r.recurring_id)) ?? []), l])
  }
  const kostenPerInv = new Map<string, Kost[]>()
  for (const r of (kostenInv.data ?? []) as Record<string, unknown>[]) kostenPerInv.set(String(r.invoice_id), [...(kostenPerInv.get(String(r.invoice_id)) ?? []), naarKost(r)])
  const kostenPerRecMaand = new Map<string, Kost[]>()
  for (const r of (kostenRec.data ?? []) as Record<string, unknown>[]) { const s = `${r.recurring_id}:${r.maand}`; kostenPerRecMaand.set(s, [...(kostenPerRecMaand.get(s) ?? []), naarKost(r)]) }

  // Recurring maandstatus (geannuleerd?) is nodig om een maand juist te tellen.
  const maandStatus = new Map<string, string>()
  if (recurringRefs.length) {
    const maanden = Array.from(new Set(recurringRefs.map((r) => r.maand)))
    const { data } = await admin.from('recurring_invoice_months').select('recurring_id, month, status').in('recurring_id', recIds).in('month', maanden)
    for (const m of (data ?? []) as { recurring_id: string; month: string; status: string }[]) maandStatus.set(`${m.recurring_id}:${m.month}`, m.status)
  }

  for (const i of (inv.data ?? []) as Record<string, unknown>[]) {
    const kop: FactuurKop = {
      ref: { invoice_id: String(i.id) }, omzet_excl: n(i.amount_excl), btw_pct: n(i.vat_pct), omzet_incl: nn(i.amount_incl), omschrijving: (i.description as string | null) ?? null,
      factuurstatus: normalizeInvoiceStatus(i.status as string), client_id: (i.client_id as string | null) ?? null, contract_id: (i.contract_id as string | null) ?? null,
      kind: (i.kind as string | null) ?? 'client', bevestigd: !!i.geen_directe_kosten_bevestigd_op, invoice_month: (i.invoice_month as string | null) ?? null,
    }
    const l = lijnenPerInv.get(kop.ref.invoice_id!) ?? []; const k = kostenPerInv.get(kop.ref.invoice_id!) ?? []
    uit.set(rijSleutel(kop.ref), { kop, lijnen: l, kosten: k, berekend: berekenKostenWinst({ omzet_excl: kop.omzet_excl, btw_pct: kop.btw_pct, omzet_incl: kop.omzet_incl, omschrijving: kop.omschrijving, factuurstatus: kop.factuurstatus, lijnen: l, kosten: k, geenDirecteKostenBevestigd: kop.bevestigd }) })
  }
  const recMap = new Map(((rec.data ?? []) as Record<string, unknown>[]).map((r) => [String(r.id), r]))
  for (const ref of recurringRefs) {
    const r = recMap.get(ref.recurring_id); if (!r) continue
    const kop: FactuurKop = {
      ref: { recurring_id: ref.recurring_id, maand: ref.maand }, omzet_excl: n(r.amount_excl), btw_pct: n(r.vat_pct), omzet_incl: nn(r.amount_incl), omschrijving: (r.description as string | null) ?? null,
      factuurstatus: normalizeInvoiceStatus(maandStatus.get(`${ref.recurring_id}:${ref.maand}`) ?? 'te_versturen'), client_id: (r.client_id as string | null) ?? null, contract_id: null,
      kind: 'client', bevestigd: !!r.geen_directe_kosten_bevestigd_op, invoice_month: ref.maand,
    }
    const l = lijnenPerRec.get(ref.recurring_id) ?? []; const k = kostenPerRecMaand.get(`${ref.recurring_id}:${ref.maand}`) ?? []
    uit.set(rijSleutel(kop.ref), { kop, lijnen: l, kosten: k, berekend: berekenKostenWinst({ omzet_excl: kop.omzet_excl, btw_pct: kop.btw_pct, omzet_incl: kop.omzet_incl, omschrijving: kop.omschrijving, factuurstatus: kop.factuurstatus, lijnen: l, kosten: k, geenDirecteKostenBevestigd: kop.bevestigd }) })
  }
  return uit
}

/** Eén factuur (of recurring maand), voor het detailscherm. */
export async function laadFactuurMetKosten(admin: Admin, ref: FactuurRef): Promise<FactuurMetKosten | null> {
  const m = ref.invoice_id ? await kostenPerFactuur(admin, [ref.invoice_id], []) : await kostenPerFactuur(admin, [], [{ recurring_id: ref.recurring_id!, maand: ref.maand! }])
  return m.get(rijSleutel(ref)) ?? null
}

export type ContractKosten = { directeKosten: number; kostenOnbekend: number; status: KostenStatus; aantalFacturen: number; omzetExcl: number }

/**
 * Directe kosten van alle klantfacturen die aan een contract hangen — de brug
 * naar het vestingcontract. Enkel `kind = 'client'` en niet-geannuleerde
 * facturen; WAM-termijnfacturen hebben hun eigen kostenmechanisme.
 */
export async function directeKostenVoorContracten(admin: Admin, contractIds: string[]): Promise<Map<string, ContractKosten>> {
  const uit = new Map<string, ContractKosten>()
  if (!contractIds.length) return uit
  const { data } = await admin.from('invoices').select('id, contract_id').in('contract_id', contractIds).or('kind.is.null,kind.eq.client')
  const rijen = (data ?? []) as { id: string; contract_id: string }[]
  const per = await kostenPerFactuur(admin, rijen.map((r) => r.id), [])
  const perContract = new Map<string, FactuurKostenWinst[]>()
  for (const r of rijen) { const f = per.get(`one:${r.id}`); if (f) perContract.set(r.contract_id, [...(perContract.get(r.contract_id) ?? []), f.berekend]) }
  for (const [cid, items] of perContract) {
    const t = telSamen(items)
    uit.set(cid, { directeKosten: t.directeKosten, kostenOnbekend: t.kostenOnbekend, status: t.status, aantalFacturen: items.filter((i) => !i.geannuleerd).length, omzetExcl: t.omzetExcl })
  }
  return uit
}

export type DirecteKostenJaar = {
  /** Directe kosten per maand (index 0 = januari), excl. btw, enkel klantfacturen. */
  perMaand: number[]
  omzetPerMaand: number[]
  totaal: number
  statusTelling: Record<KostenStatus, number>
  aantalFacturen: number
  /** Per factuur, voor de export. */
  facturen: FactuurMetKosten[]
}

/** Financiën: doorgerekende kosten per maand van een boekjaar, uit de facturen. */
export async function directeKostenPerJaar(admin: Admin, year: number): Promise<DirecteKostenJaar> {
  const [{ data: inv }, { data: rec }] = await Promise.all([
    admin.from('invoices').select('id, invoice_month, kind, status').like('invoice_month', `${year}-%`),
    admin.from('recurring_invoices').select('*'),
  ])
  const invoiceIds = ((inv ?? []) as { id: string; kind: string | null }[]).filter((i) => (i.kind ?? 'client') === 'client').map((i) => i.id)
  const refs: { recurring_id: string; maand: string }[] = []
  for (const r of (rec ?? []) as RecurringInvoice[]) for (let mi = 0; mi < 12; mi++) { const maand = `${year}-${String(mi + 1).padStart(2, '0')}`; if (recurringActiveInMonth(r, maand)) refs.push({ recurring_id: r.id, maand }) }
  const per = await kostenPerFactuur(admin, invoiceIds, refs)
  const perMaand = Array(12).fill(0) as number[]; const omzetPerMaand = Array(12).fill(0) as number[]
  const statusTelling: Record<KostenStatus, number> = { volledig: 0, voorlopig: 0, controle_vereist: 0, geen_directe_kosten: 0, ongecontroleerd: 0 }
  const facturen: FactuurMetKosten[] = []
  for (const f of per.values()) {
    facturen.push(f)
    if (f.berekend.geannuleerd) continue
    const mi = Number((f.kop.invoice_month ?? '').slice(5, 7)) - 1
    if (mi >= 0 && mi < 12) { perMaand[mi] += f.berekend.directeKosten; omzetPerMaand[mi] += f.berekend.omzetExcl }
    statusTelling[f.berekend.status]++
  }
  return { perMaand, omzetPerMaand, totaal: perMaand.reduce((s, v) => s + v, 0), statusTelling, aantalFacturen: facturen.filter((f) => !f.berekend.geannuleerd).length, facturen }
}

export type KostprijsSuggestie = { kostprijs_maand: number | null; kostprijs_jaar: number | null; bron: string | null; categorie: string | null }

/**
 * Kostprijs voorstellen uit wat de app al weet. Vandaag: hosting uit de
 * Framer-sites van de klant (wat wij aan Framer betalen). Andere bronnen
 * bestaan niet in het datamodel; dan blijft de kostprijs leeg.
 */
export async function kostprijsSuggestie(admin: Admin, clientId: string | null, omschrijving: string): Promise<KostprijsSuggestie> {
  const categorie = vermoedelijkeKostenlijn(omschrijving)
  const leeg: KostprijsSuggestie = { kostprijs_maand: null, kostprijs_jaar: null, bron: null, categorie }
  if (!clientId || categorie !== 'Hosting') return leeg
  try {
    const { data } = await admin.from('framer_sites').select('naam, bedrag_excl, facturatie, opgezegd_op').eq('client_id', clientId).is('opgezegd_op', null).limit(1)
    const s = ((data ?? []) as { naam: string; bedrag_excl: number; facturatie: string }[])[0]
    if (!s) return leeg
    const bedrag = n(s.bedrag_excl)
    const perMaand = s.facturatie === 'annual' ? bedrag / 12 : bedrag
    return { kostprijs_maand: Math.round(perMaand * 100) / 100, kostprijs_jaar: Math.round(perMaand * 12 * 100) / 100, bron: `Framer-site "${s.naam}" (${s.facturatie === 'annual' ? 'jaarlijks' : 'maandelijks'} ${bedrag} excl. btw)`, categorie }
  } catch { return leeg }
}

/** Auditregel; mag nooit breken. */
export async function logKost(admin: Admin, r: {
  ref: FactuurRef; line_id?: string | null; cost_id?: string | null; actie: string; oud?: unknown; nieuw?: unknown
  effect_winst?: number | null; effect_vesting?: number | null; reden?: string | null; actor_user_id?: string | null; actor_email?: string | null
}): Promise<void> {
  try {
    await admin.from('invoice_cost_log').insert({
      invoice_id: r.ref.invoice_id ?? null, recurring_id: r.ref.recurring_id ?? null, maand: r.ref.maand ?? null,
      line_id: r.line_id ?? null, cost_id: r.cost_id ?? null, actie: r.actie, oud: r.oud ?? null, nieuw: r.nieuw ?? null,
      effect_winst: r.effect_winst ?? null, effect_vesting: r.effect_vesting ?? null, reden: r.reden ?? null,
      actor_user_id: r.actor_user_id ?? null, actor_email: r.actor_email ?? null,
    })
  } catch { /* audit mag nooit de hoofdflow breken */ }
}

/** Hangt deze factuur (via haar contract) aan een vestingcontract? Dan raakt een kost de vesting. */
export async function raaktVesting(admin: Admin, contractId: string | null): Promise<boolean> {
  if (!contractId) return false
  try { const { data } = await admin.from('vesting_contracten').select('id').eq('contract_id', contractId).limit(1); return ((data ?? []) as unknown[]).length > 0 } catch { return false }
}
