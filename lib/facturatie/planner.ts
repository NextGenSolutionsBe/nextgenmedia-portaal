import 'server-only'
import { recurringActiveInMonth, billingDateFor, inclFromExcl, normalizeInvoiceStatus, shiftYM, type RecurringInvoice } from '@/lib/invoices'
import { SERVICE_LABELS } from '@/lib/utils'
import { leesInstellingen } from '@/lib/instellingen/laden'
import { bepaalStatus, ymVan, momentSleutel, magVerplaatsen, verwachtOp, type Moment, type Herkomst } from './planner-model'

/**
 * De ENIGE plek die facturatiemomenten samenstelt. Kalender, lijst en de
 * dashboardkaarten lezen allemaal deze lijst, dus tellen ze altijd gelijk.
 *
 * Bronnen:
 *  - invoices (eenmalige facturen, ook die uit een contract of WAM ontstaan)
 *  - recurring_invoices × maanden (met momentopname per maand als die bestaat)
 *  - (facturen uit een contract zijn gewone invoices met contract_id; de app
 *    leidt niets meer automatisch uit een contract af)
 *  - vesting_wam_termijnen (WAM-portefeuille, nog zonder factuur)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

type Klant = { id: string; company_name: string | null; btw_nummer: string | null; email: string | null }

const svc = (s: string | null) => (s ? (SERVICE_LABELS[s] ?? s) : null)
/** Betaaltermijn in dagen; standaard 30, per factuur aanpasbaar. */
const termijnVan = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) && n >= 0 && v !== null && v !== undefined && v !== '' ? Math.round(n) : 30 }
const dagVan = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null)

function maandenTussen(van: string, tot: string): string[] {
  const uit: string[] = []
  let m = ymVan(van)
  const eind = ymVan(tot)
  for (let i = 0; i < 40 && m <= eind; i++) { uit.push(m); m = shiftYM(m, 1) }
  return uit
}

export async function laadMomenten(admin: Admin, van: string, tot: string, vandaag: string): Promise<{ momenten: Moment[]; klanten: { id: string; company_name: string }[]; verantwoordelijke: string }> {
  const maanden = maandenTussen(van, tot)
  const [inst, { data: klantRijen }, { data: facturen }, { data: recurring }, { data: maandRijen }, { data: termijnen }] = await Promise.all([
    leesInstellingen(),
    admin.from('clients').select('id, company_name, btw_nummer, email').order('company_name'),
    admin.from('invoices').select('*').gte('invoice_date', van).lte('invoice_date', tot),
    admin.from('recurring_invoices').select('*'),
    admin.from('recurring_invoice_months').select('*').in('month', maanden),
    admin.from('vesting_wam_termijnen').select('id, wam_id, volgnr, periode, factuurdatum, bedrag_excl, btw_pct, status, betaald_op, invoice_id, notitie').gte('factuurdatum', van).lte('factuurdatum', tot).is('invoice_id', null),
  ])
  const verantwoordelijke = inst.facturatie.verantwoordelijke_naam || inst.facturatie.clickup_assignee_naam || 'Bram Reinquin'
  const klanten = new Map<string, Klant>(((klantRijen ?? []) as Klant[]).map((k) => [k.id, k]))
  const naam = (id: string | null) => (id ? (klanten.get(id)?.company_name ?? 'Onbekende klant') : 'Geen klant')

  // Contracttitels en WAM-namen voor de gekoppelde rijen (best-effort).
  const contractIds = new Set<string>()
  for (const i of (facturen ?? []) as { contract_id?: string | null }[]) if (i.contract_id) contractIds.add(i.contract_id)
  for (const r of (recurring ?? []) as { contract_id?: string | null }[]) if (r.contract_id) contractIds.add(r.contract_id)
  const contractTitel = new Map<string, string>()
  if (contractIds.size) {
    try {
      const { data } = await admin.from('contracts').select('id, title').in('id', [...contractIds])
      for (const c of (data ?? []) as { id: string; title: string | null }[]) contractTitel.set(c.id, c.title ?? '')
    } catch { /* geen titels */ }
  }
  const wamIds = [...new Set(((termijnen ?? []) as { wam_id: string }[]).map((t) => t.wam_id))]
  const wamInfo = new Map<string, { nr: string; klant: string }>()
  if (wamIds.length) {
    try {
      const { data } = await admin.from('vesting_wam').select('id, nr, klant').in('id', wamIds)
      for (const w of (data ?? []) as { id: string; nr: string; klant: string }[]) wamInfo.set(w.id, { nr: w.nr, klant: w.klant })
    } catch { /* geen WAM-info */ }
  }

  const uit: Moment[] = []

  // ── Eenmalige facturen ──
  for (const i of (facturen ?? []) as Record<string, unknown>[]) {
    const kind = (i.kind as string | null) ?? 'client'
    if (kind.startsWith('setter')) continue   // afrekeningen die WIJ ontvangen horen niet in onze planner
    const datum = String(i.invoice_date).slice(0, 10)
    const bedrag = Number(i.amount_excl) || 0
    const ontbrekend: string[] = []
    if (!i.client_id) ontbrekend.push('klant ontbreekt')
    if (bedrag <= 0) ontbrekend.push('bedrag ontbreekt')
    let ruwe: string = normalizeInvoiceStatus(i.status as string)
    // Volledig betaald? Dan toont de planner dat ook (groen, "Verstuurd · betaald").
    const betaaldBedrag = Number(i.betaald_bedrag) || 0
    const inclTotaal = Number(i.amount_incl) || 0
    if (ruwe === 'verstuurd' && (i.betaalstatus === 'betaald' || (inclTotaal > 0 && betaaldBedrag >= inclTotaal - 0.005))) ruwe = 'betaald'
    const status = bepaalStatus({ ruweStatus: ruwe, datum, ontbrekend, vandaag })
    const herkomst: Herkomst = i.contract_id ? 'contract' : kind === 'wam' ? 'wam' : 'eenmalig'
    const actief = status !== 'verstuurd' && status !== 'betaald' && status !== 'geannuleerd' && status !== 'gecrediteerd'
    const maand = ymVan(datum)
    uit.push({
      id: momentSleutel('invoice', String(i.id)), bron: 'invoice', bronId: String(i.id), maand, datum,
      client_id: (i.client_id as string | null) ?? null, klant: naam((i.client_id as string | null) ?? null),
      project: i.contract_id ? (contractTitel.get(String(i.contract_id)) || null) : svc((i.service_slug as string | null) ?? null),
      omschrijving: (i.description as string | null) ?? null,
      type: kind === 'wam' ? 'WAM-factuur' : 'Eenmalig',
      bedrag_excl: bedrag, btw_pct: Number(i.vat_pct) || 0, bedrag_incl: Number(i.amount_incl) || inclFromExcl(bedrag, Number(i.vat_pct) || 0),
      status, ruweStatus: ruwe, herkomst, terugkerend: false, verantwoordelijke: (i.verantwoordelijke as string | null) || verantwoordelijke,
      volledig: ontbrekend.length === 0, ontbrekend,
      contract_id: (i.contract_id as string | null) ?? null, contract_titel: i.contract_id ? (contractTitel.get(String(i.contract_id)) ?? null) : null,
      recurring_id: null, invoice_id: String(i.id), wam_id: (i.wam_id as string | null) ?? null, schema: null, opmerking: (i.note as string | null) ?? null,
      dienst: svc((i.service_slug as string | null) ?? null), betaaltermijn: termijnVan(i.payment_term_days), verzonden_op: dagVan(i.sent_at), verzonden_door: (i.sent_by_email as string | null) ?? null,
      verwacht_op: dagVan(i.due_date) ?? verwachtOp(dagVan(i.sent_at), datum, termijnVan(i.payment_term_days)),
      acties: {
        bekijkenUrl: `/admin/invoices?maand=${maand}`, aanpassenUrl: `/admin/invoices?maand=${maand}`, voorbereidenUrl: null,
        kanVerstuurd: actief, kanVerplaatsen: magVerplaatsen(status), kanAnnuleren: actief, 
      },
    })
  }

  // ── Terugkerende facturaties × maanden ──
  type MaandRij = { recurring_id: string; month: string; status: string | null; billing_date: string | null; amount_excl: number | null; vat_pct: number | null; amount_incl: number | null; invoice_id: string | null; note: string | null; sent_at?: string | null; sent_by_email?: string | null }
  const perMaand = new Map<string, MaandRij>(((maandRijen ?? []) as MaandRij[]).map((r) => [`${r.recurring_id}:${r.month}`, r]))
  for (const r of (recurring ?? []) as (RecurringInvoice & { deleted_at?: string | null; contract_id?: string | null; verantwoordelijke?: string | null; payment_term_days?: number | null })[]) {
    for (const m of maanden) {
      if (!recurringActiveInMonth(r, m)) continue
      const rij = perMaand.get(`${r.id}:${m}`)
      const datum = (rij?.billing_date ?? billingDateFor(m, r.invoice_day)).slice(0, 10)
      if (datum < van || datum > tot) continue
      const excl = rij?.amount_excl != null ? Number(rij.amount_excl) : Number(r.amount_excl) || 0
      const btw = rij?.vat_pct != null ? Number(rij.vat_pct) : Number(r.vat_pct) || 0
      const incl = rij?.amount_incl != null ? Number(rij.amount_incl) : inclFromExcl(excl, btw)
      const ontbrekend: string[] = []
      if (!r.client_id) ontbrekend.push('klant ontbreekt')
      if (excl <= 0) ontbrekend.push('bedrag ontbreekt')
      const ruwe = rij?.status ? normalizeInvoiceStatus(rij.status) : 'te_versturen'
      const status = bepaalStatus({ ruweStatus: ruwe, datum, ontbrekend, vandaag })
      const actief = status !== 'verstuurd' && status !== 'betaald' && status !== 'geannuleerd'
      const start = (r.start_month ?? '').slice(0, 7), eind = r.end_month ? r.end_month.slice(0, 7) : null
      const dagLabel = r.invoice_day === 'first' ? 'dag 1' : r.invoice_day === 'mid' ? 'dag 15' : 'laatste dag'
      uit.push({
        id: momentSleutel('recurring', r.id, m), bron: 'recurring', bronId: r.id, maand: m, datum,
        client_id: r.client_id, klant: naam(r.client_id), project: r.contract_id ? (contractTitel.get(r.contract_id) || svc(r.service_slug)) : svc(r.service_slug), omschrijving: r.description,
        type: 'Maandfactuur', bedrag_excl: excl, btw_pct: btw, bedrag_incl: incl,
        status, ruweStatus: ruwe, herkomst: r.contract_id ? 'contract' : 'recurring', terugkerend: true, verantwoordelijke: r.verantwoordelijke || verantwoordelijke,
        volledig: ontbrekend.length === 0, ontbrekend,
        contract_id: r.contract_id ?? null, contract_titel: r.contract_id ? (contractTitel.get(r.contract_id) ?? null) : null, recurring_id: r.id, invoice_id: rij?.invoice_id ?? null, wam_id: null,
        schema: `Maandelijks (${dagLabel}) · ${start} → ${eind ?? 'doorlopend'}${r.deleted_at ? ' · stopgezet' : ''}`,
        opmerking: rij?.note ?? null,
        dienst: svc(r.service_slug), betaaltermijn: termijnVan(r.payment_term_days), verzonden_op: dagVan(rij?.sent_at), verzonden_door: rij?.sent_by_email ?? null,
        verwacht_op: verwachtOp(dagVan(rij?.sent_at), datum, termijnVan(r.payment_term_days)),
        acties: {
          bekijkenUrl: `/admin/invoices?maand=${m}`, aanpassenUrl: `/admin/invoices?maand=${m}`, voorbereidenUrl: null,
          kanVerstuurd: actief, kanVerplaatsen: magVerplaatsen(status), kanAnnuleren: actief, 
        },
      })
    }
  }


  // ── WAM-termijnen (Vesting), nog zonder factuur ──
  type Termijn = { id: string; wam_id: string; volgnr: number; periode: string; factuurdatum: string; bedrag_excl: number; btw_pct: number; status: string; betaald_op: string | null; notitie: string | null }
  for (const t of (termijnen ?? []) as Termijn[]) {
    const datum = String(t.factuurdatum).slice(0, 10)
    const excl = Number(t.bedrag_excl) || 0, btw = Number(t.btw_pct) || 21
    const info = wamInfo.get(t.wam_id)
    const status = bepaalStatus({ ruweStatus: t.status, datum, ontbrekend: [], vandaag })
    uit.push({
      id: momentSleutel('wam', t.id), bron: 'wam', bronId: t.id, maand: ymVan(datum), datum,
      client_id: null, klant: info?.klant ?? 'WAM-klant', project: info ? `${info.nr} · ${t.periode}` : t.periode, omschrijving: null,
      type: `WAM-termijn ${t.volgnr}`, bedrag_excl: excl, btw_pct: btw, bedrag_incl: inclFromExcl(excl, btw),
      status, ruweStatus: t.status, herkomst: 'wam', terugkerend: true, verantwoordelijke,
      volledig: true, ontbrekend: [],
      contract_id: null, contract_titel: null, recurring_id: null, invoice_id: null, wam_id: t.wam_id,
      schema: 'WAM-schema (Vesting)', opmerking: t.notitie,
      dienst: 'WAM', betaaltermijn: 30, verzonden_op: null, verzonden_door: null, verwacht_op: verwachtOp(null, datum, 30),
      acties: { bekijkenUrl: '/admin/vesting', aanpassenUrl: '/admin/vesting', voorbereidenUrl: '/admin/vesting', kanVerstuurd: false, kanVerplaatsen: false, kanAnnuleren: false },
    })
  }

  uit.sort((a, b) => a.datum.localeCompare(b.datum) || a.klant.localeCompare(b.klant, 'nl'))
  return {
    momenten: uit,
    klanten: [...klanten.values()].map((k) => ({ id: k.id, company_name: k.company_name ?? 'Onbekende klant' })),
    verantwoordelijke,
  }
}
