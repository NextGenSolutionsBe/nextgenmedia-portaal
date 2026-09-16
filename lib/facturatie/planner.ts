import 'server-only'
import { recurringActiveInMonth, billingDateFor, inclFromExcl, normalizeInvoiceStatus, shiftYM, type RecurringInvoice } from '@/lib/invoices'
import { SERVICE_LABELS } from '@/lib/utils'
import { clickupConfigured } from '@/lib/clickup'
import { leesInstellingen } from '@/lib/instellingen/laden'
import { TYPE_LABEL, type OpdrachtType } from './schema'
import { bepaalStatus, ymVan, momentSleutel, magVerplaatsen, type Moment, type Herkomst, type ClickupSync } from './planner-model'

/**
 * De ENIGE plek die facturatiemomenten samenstelt. Kalender, lijst en de
 * dashboardkaarten lezen allemaal deze lijst, dus tellen ze altijd gelijk.
 *
 * Bronnen:
 *  - invoices (eenmalige facturen, ook die uit een contract of WAM ontstaan)
 *  - recurring_invoices × maanden (met momentopname per maand als die bestaat)
 *  - contract_facturatie_opdrachten (ondertekend contract, nog zonder factuur)
 *  - vesting_wam_termijnen (WAM-portefeuille, nog zonder factuur)
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

type Klant = { id: string; company_name: string | null; btw_nummer: string | null; email: string | null }

const svc = (s: string | null) => (s ? (SERVICE_LABELS[s] ?? s) : null)
const taakUrl = (id: string | null) => (id ? `https://app.clickup.com/t/${id}` : null)

function maandenTussen(van: string, tot: string): string[] {
  const uit: string[] = []
  let m = ymVan(van)
  const eind = ymVan(tot)
  for (let i = 0; i < 40 && m <= eind; i++) { uit.push(m); m = shiftYM(m, 1) }
  return uit
}

export async function laadMomenten(admin: Admin, van: string, tot: string, vandaag: string): Promise<{ momenten: Moment[]; klanten: { id: string; company_name: string }[]; verantwoordelijke: string; clickup: boolean }> {
  const maanden = maandenTussen(van, tot)
  const clickup = clickupConfigured()
  const [inst, { data: klantRijen }, { data: facturen }, { data: recurring }, { data: maandRijen }, { data: opdrachten }, { data: termijnen }] = await Promise.all([
    leesInstellingen(),
    admin.from('clients').select('id, company_name, btw_nummer, email').order('company_name'),
    admin.from('invoices').select('*').gte('invoice_date', van).lte('invoice_date', tot),
    admin.from('recurring_invoices').select('*'),
    admin.from('recurring_invoice_months').select('*').in('month', maanden),
    admin.from('contract_facturatie_opdrachten').select('*').gte('factuurdatum', van).lte('factuurdatum', tot).neq('status', 'afgehandeld'),
    admin.from('vesting_wam_termijnen').select('id, wam_id, volgnr, periode, factuurdatum, bedrag_excl, btw_pct, status, betaald_op, invoice_id, clickup_task_id, notitie').gte('factuurdatum', van).lte('factuurdatum', tot).is('invoice_id', null),
  ])
  const verantwoordelijke = inst.facturatie.clickup_assignee_naam || 'Bram Reinquin'
  const klanten = new Map<string, Klant>(((klantRijen ?? []) as Klant[]).map((k) => [k.id, k]))
  const naam = (id: string | null) => (id ? (klanten.get(id)?.company_name ?? 'Onbekende klant') : 'Geen klant')

  // Contracttitels en WAM-namen voor de gekoppelde rijen (best-effort).
  const contractIds = new Set<string>()
  for (const i of (facturen ?? []) as { contract_id?: string | null }[]) if (i.contract_id) contractIds.add(i.contract_id)
  for (const o of (opdrachten ?? []) as { contract_id: string }[]) contractIds.add(o.contract_id)
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
  const sync = (taskId: string | null, fout?: string | null): ClickupSync => (!clickup ? 'nvt' : fout ? 'mislukt' : taskId ? 'gesynchroniseerd' : 'geen')

  // ── Eenmalige facturen ──
  for (const i of (facturen ?? []) as Record<string, unknown>[]) {
    const kind = (i.kind as string | null) ?? 'client'
    if (kind.startsWith('setter')) continue   // afrekeningen die WIJ ontvangen horen niet in onze planner
    const datum = String(i.invoice_date).slice(0, 10)
    const bedrag = Number(i.amount_excl) || 0
    const ontbrekend: string[] = []
    if (!i.client_id) ontbrekend.push('klant ontbreekt')
    if (bedrag <= 0) ontbrekend.push('bedrag ontbreekt')
    const ruwe = normalizeInvoiceStatus(i.status as string)
    const status = bepaalStatus({ ruweStatus: ruwe, datum, ontbrekend, vandaag })
    const herkomst: Herkomst = i.contract_id ? 'contract' : kind === 'wam' ? 'wam' : 'eenmalig'
    const actief = status !== 'verstuurd' && status !== 'betaald' && status !== 'geannuleerd'
    const maand = ymVan(datum)
    uit.push({
      id: momentSleutel('invoice', String(i.id)), bron: 'invoice', bronId: String(i.id), maand, datum,
      client_id: (i.client_id as string | null) ?? null, klant: naam((i.client_id as string | null) ?? null),
      project: i.contract_id ? (contractTitel.get(String(i.contract_id)) || null) : svc((i.service_slug as string | null) ?? null),
      omschrijving: (i.description as string | null) ?? null,
      type: kind === 'wam' ? 'WAM-factuur' : 'Eenmalig',
      bedrag_excl: bedrag, btw_pct: Number(i.vat_pct) || 0, bedrag_incl: Number(i.amount_incl) || inclFromExcl(bedrag, Number(i.vat_pct) || 0),
      status, ruweStatus: ruwe, herkomst, terugkerend: false, verantwoordelijke,
      clickup_task_id: (i.clickup_task_id as string | null) ?? null, clickup_url: taakUrl((i.clickup_task_id as string | null) ?? null), clickup_sync: sync((i.clickup_task_id as string | null) ?? null), clickup_fout: null,
      volledig: ontbrekend.length === 0, ontbrekend,
      contract_id: (i.contract_id as string | null) ?? null, contract_titel: i.contract_id ? (contractTitel.get(String(i.contract_id)) ?? null) : null,
      recurring_id: null, invoice_id: String(i.id), wam_id: (i.wam_id as string | null) ?? null, schema: null, opmerking: (i.note as string | null) ?? null,
      acties: {
        bekijkenUrl: `/admin/invoices?maand=${maand}`, aanpassenUrl: `/admin/invoices?maand=${maand}`, voorbereidenUrl: null,
        kanVerstuurd: actief, kanVerplaatsen: magVerplaatsen(status), kanAnnuleren: actief, kanSync: clickup && actief && !i.clickup_task_id,
      },
    })
  }

  // ── Terugkerende facturaties × maanden ──
  type MaandRij = { recurring_id: string; month: string; status: string | null; clickup_task_id: string | null; billing_date: string | null; amount_excl: number | null; vat_pct: number | null; amount_incl: number | null; invoice_id: string | null; note: string | null }
  const perMaand = new Map<string, MaandRij>(((maandRijen ?? []) as MaandRij[]).map((r) => [`${r.recurring_id}:${r.month}`, r]))
  for (const r of (recurring ?? []) as (RecurringInvoice & { deleted_at?: string | null })[]) {
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
        client_id: r.client_id, klant: naam(r.client_id), project: svc(r.service_slug), omschrijving: r.description,
        type: 'Maandfactuur', bedrag_excl: excl, btw_pct: btw, bedrag_incl: incl,
        status, ruweStatus: ruwe, herkomst: 'recurring', terugkerend: true, verantwoordelijke,
        clickup_task_id: rij?.clickup_task_id ?? null, clickup_url: taakUrl(rij?.clickup_task_id ?? null), clickup_sync: sync(rij?.clickup_task_id ?? null), clickup_fout: null,
        volledig: ontbrekend.length === 0, ontbrekend,
        contract_id: null, contract_titel: null, recurring_id: r.id, invoice_id: rij?.invoice_id ?? null, wam_id: null,
        schema: `Maandelijks (${dagLabel}) · ${start} → ${eind ?? 'doorlopend'}${r.deleted_at ? ' · stopgezet' : ''}`,
        opmerking: rij?.note ?? null,
        acties: {
          bekijkenUrl: `/admin/invoices?maand=${m}`, aanpassenUrl: `/admin/invoices?maand=${m}`, voorbereidenUrl: null,
          kanVerstuurd: actief, kanVerplaatsen: magVerplaatsen(status), kanAnnuleren: actief, kanSync: clickup && actief && !rij?.clickup_task_id,
        },
      })
    }
  }

  // ── Facturatieopdrachten uit ondertekende contracten (nog zonder factuur) ──
  type Opd = { id: string; contract_id: string; client_id: string | null; volgnr: number; aantal: number; type: OpdrachtType; factuurdatum: string; periode: string | null; bedrag_excl: number | null; btw_pct: number | null; bedrag_incl: number | null; omschrijving: string | null; status: string; ontbrekend: string[] | null; aandachtspunten: string[] | null; sync_status: string | null; clickup_task_id: string | null; clickup_url: string | null; sync_fout: string | null; invoice_id: string | null }
  for (const o of (opdrachten ?? []) as Opd[]) {
    if (o.invoice_id) continue   // de factuur zelf staat al in de lijst
    const datum = String(o.factuurdatum).slice(0, 10)
    const excl = Number(o.bedrag_excl) || 0, btw = Number(o.btw_pct) || 21
    const ontbrekend = [...(o.ontbrekend ?? [])]
    if (!o.client_id) ontbrekend.push('klant ontbreekt')
    if (excl <= 0 && !ontbrekend.some((x) => /bedrag/i.test(x))) ontbrekend.push('bedrag ontbreekt')
    const status = bepaalStatus({ ruweStatus: o.status, datum, ontbrekend, vandaag })
    const actief = status !== 'verstuurd' && status !== 'betaald' && status !== 'geannuleerd'
    const typeLabel = `${TYPE_LABEL[o.type] ?? o.type}${o.aantal > 1 ? ` ${o.volgnr}/${o.aantal}` : ''}`
    uit.push({
      id: momentSleutel('opdracht', o.id), bron: 'opdracht', bronId: o.id, maand: ymVan(datum), datum,
      client_id: o.client_id, klant: naam(o.client_id), project: contractTitel.get(o.contract_id) || null, omschrijving: o.omschrijving,
      type: typeLabel, bedrag_excl: excl, btw_pct: btw, bedrag_incl: Number(o.bedrag_incl) || inclFromExcl(excl, btw),
      status, ruweStatus: o.status, herkomst: 'contract', terugkerend: o.type === 'periodiek', verantwoordelijke,
      clickup_task_id: o.clickup_task_id, clickup_url: o.clickup_url ?? taakUrl(o.clickup_task_id), clickup_sync: sync(o.clickup_task_id, o.sync_status === 'mislukt' ? (o.sync_fout ?? 'mislukt') : null), clickup_fout: o.sync_status === 'mislukt' ? o.sync_fout : null,
      volledig: ontbrekend.length === 0, ontbrekend,
      contract_id: o.contract_id, contract_titel: contractTitel.get(o.contract_id) ?? null, recurring_id: null, invoice_id: null, wam_id: null,
      schema: o.periode, opmerking: (o.aandachtspunten ?? []).join(' · ') || null,
      acties: {
        bekijkenUrl: `/admin/contracts/${o.contract_id}#facturatie`, aanpassenUrl: `/admin/contracts/${o.contract_id}#facturatie`, voorbereidenUrl: actief ? `/admin/contracts/${o.contract_id}#facturatie` : null,
        kanVerstuurd: false, kanVerplaatsen: magVerplaatsen(status), kanAnnuleren: actief, kanSync: clickup && actief,
      },
    })
  }

  // ── WAM-termijnen (Vesting), nog zonder factuur ──
  type Termijn = { id: string; wam_id: string; volgnr: number; periode: string; factuurdatum: string; bedrag_excl: number; btw_pct: number; status: string; betaald_op: string | null; clickup_task_id: string | null; notitie: string | null }
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
      clickup_task_id: t.clickup_task_id, clickup_url: taakUrl(t.clickup_task_id), clickup_sync: sync(t.clickup_task_id), clickup_fout: null,
      volledig: true, ontbrekend: [],
      contract_id: null, contract_titel: null, recurring_id: null, invoice_id: null, wam_id: t.wam_id,
      schema: 'WAM-schema (Vesting)', opmerking: t.notitie,
      acties: { bekijkenUrl: '/admin/vesting', aanpassenUrl: '/admin/vesting', voorbereidenUrl: '/admin/vesting', kanVerstuurd: false, kanVerplaatsen: false, kanAnnuleren: false, kanSync: false },
    })
  }

  uit.sort((a, b) => a.datum.localeCompare(b.datum) || a.klant.localeCompare(b.klant, 'nl'))
  return {
    momenten: uit,
    klanten: [...klanten.values()].map((k) => ({ id: k.id, company_name: k.company_name ?? 'Onbekende klant' })),
    verantwoordelijke, clickup,
  }
}
