import { leesGetal } from '@/lib/getal'
import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  inclFromExcl, lastDayOfMonth, billingDateFor, expandRevenueForMonth, normalizeInvoiceStatus,
  recurringActiveInMonth, INVOICE_STATUSES, INVOICE_DAYS, DEFAULT_VAT, type RevenueEntry, type RecurringInvoice,
} from '@/lib/invoices'
import { removeAutoSetterInvoices } from '@/lib/sales/setter-invoices'
import { normaliseerRegels, berekenTotalen, regelUitBedrag } from '@/lib/facturen/regels'
import { kostenPerFactuur, logKost, type FactuurRef } from '@/lib/facturen/kosten-data'
import { stelClassificatieVoor, type KostenStatus, type Classificatie } from '@/lib/facturen/kosten-winst'
import { stopRecurring, zetMaandStatus, werkToekomstigeMaandenBij } from '@/lib/facturatie/recurring'
import { requestMeta } from '@/lib/audit'
import { magIk } from '@/lib/instellingen/laden'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

export const maxDuration = 60

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = { from: (t: string) => any }

/**
 * Koppelt een factuur automatisch aan de bijhorende prognose (revenue_entry).
 * Match op klant + dienst + maand + bedrag excl. Bestaat er geen → maak er een aan.
 * Best-effort: faalt dit, dan blijft de factuur gewoon ongekoppeld.
 */
async function linkOrCreateForecast(admin: Admin, p: {
  client_id: string | null; service_slug: string | null; month: string; amount_excl: number
  description: string | null; recurring: boolean; start_month?: string; end_month?: string | null
}): Promise<string | null> {
  try {
    const { data: entries } = await admin.from('revenue_entries').select('*')
    const match = ((entries ?? []) as RevenueEntry[]).find((e) => {
      if ((e.client_id ?? null) !== (p.client_id ?? null)) return false
      if ((e.service_slug ?? null) !== (p.service_slug ?? null)) return false
      const amt = e.type === 'recurring' ? Number(e.amount_per_month) || 0 : Number(e.amount) || 0
      if (Math.abs(amt - p.amount_excl) > 0.01) return false
      if (e.type === 'recurring') {
        const s = (e.start_month ?? '').slice(0, 7), en = e.end_month ? e.end_month.slice(0, 7) : null
        return !!s && s <= p.month && (!en || p.month <= en)
      }
      return (e.transaction_month ?? '').slice(0, 7) === p.month
    })
    if (match) return match.id

    const insert: Record<string, unknown> = {
      client_id: p.client_id, service_slug: p.service_slug, title: p.description || 'Automatische prognose',
      notes: 'Automatisch aangemaakt vanuit een factuur',
    }
    if (p.recurring) {
      insert.type = 'recurring'; insert.amount_per_month = p.amount_excl
      insert.start_month = `${(p.start_month ?? p.month)}-01`; insert.end_month = p.end_month ? `${p.end_month}-01` : null
    } else {
      insert.type = 'one_time'; insert.amount = p.amount_excl; insert.transaction_month = `${p.month}-01`
    }
    // Veerkrachtig: laat ontbrekende (niet-gemigreerde) kolommen vallen zodat de
    // prognose ALTIJD wordt aangemaakt (anders kreeg je een factuur zonder prognose).
    return await safeInsertId(admin, 'revenue_entries', insert)
  } catch { return null }
}

// Veerkrachtig insert/upsert: als een (nog niet gemigreerde) kolom ontbreekt
// ("Could not find the 'X' column"), laat die kolom vallen en probeer opnieuw.
// Zo blijven facturen werken ook al is de migratie nog niet gedraaid.
/**
 * Factuurlijnen die bij het opmaken meegegeven zijn (intern: classificatie,
 * kostprijs, leverancier). Raakt het factuurbedrag niet — dat staat al vast.
 * Best-effort: een fout hier laat de factuur zelf staan.
 */
type LijnInvoer = { omschrijving?: unknown; aantal?: unknown; prijs_excl?: unknown; btw_pct?: unknown; classificatie?: unknown; opmerking?: unknown; kostprijs_excl?: unknown; leverancier?: unknown; categorie?: unknown }
async function slaLijnenOp(admin: Admin, ref: FactuurRef, lijnen: unknown, actor: { id: string; email?: string | null }): Promise<void> {
  if (!Array.isArray(lijnen) || lijnen.length === 0) return
  const num = (v: unknown): number | null => leesGetal(v)
  const txt = (v: unknown): string | null => { const t = String(v ?? '').trim(); return t || null }
  let volgnr = 0
  for (const raw of lijnen as LijnInvoer[]) {
    const omschrijving = txt(raw.omschrijving); if (!omschrijving) continue
    volgnr++
    const classificatie: Classificatie = ['dienst', 'doorgerekende_kost', 'gemengd'].includes(String(raw.classificatie)) ? (raw.classificatie as Classificatie) : 'dienst'
    try {
      const { data: l, error } = await admin.from('invoice_lines').insert({
        invoice_id: ref.invoice_id ?? null, recurring_id: ref.recurring_id ?? null, volgnr, omschrijving,
        aantal: num(raw.aantal) ?? 1, prijs_excl: num(raw.prijs_excl) ?? 0, btw_pct: num(raw.btw_pct) ?? DEFAULT_VAT, classificatie, opmerking: txt(raw.opmerking),
      }).select('id').single()
      if (error || !l) continue
      const kostprijs = num(raw.kostprijs_excl)
      let costId: string | null = null
      // Een kostprijs of leverancier bij de lijn → één kostrecord aan die lijn.
      // Bij een recurring factuur hoort de kost bij de startmaand; latere maanden krijgen hun kost apart.
      if (kostprijs !== null || txt(raw.leverancier)) {
        const { data: k } = await admin.from('invoice_costs').insert({
          invoice_id: ref.invoice_id ?? null, recurring_id: ref.recurring_id ?? null, maand: ref.maand ?? null, line_id: l.id,
          omschrijving, categorie: txt(raw.categorie) ?? stelClassificatieVoor(omschrijving).categorie, leverancier: txt(raw.leverancier), kostprijs_excl: kostprijs, created_by: actor.id,
        }).select('id').single()
        costId = (k?.id as string | undefined) ?? null
      }
      await logKost(admin, { ref, line_id: l.id as string, cost_id: costId, actie: 'lijn_toevoegen', nieuw: { omschrijving, classificatie, prijs_excl: num(raw.prijs_excl), kostprijs_excl: kostprijs }, effect_winst: kostprijs !== null ? -kostprijs : null, actor_user_id: actor.id, actor_email: actor.email ?? null, reden: 'bij het opmaken van de factuur' })
    } catch { /* best-effort */ }
  }
}

async function safeInsertId(admin: Admin, table: string, row: Record<string, unknown>): Promise<string> {
  const r: Record<string, unknown> = { ...row }
  for (let i = 0; i < 6; i++) {
    const { data, error } = await admin.from(table).insert(r).select('id').single()
    if (!error) return data.id as string
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in r) { delete r[col]; continue }
    throw new Error(error.message)
  }
  throw new Error('Insert mislukt')
}
async function safeUpsert(admin: Admin, table: string, row: Record<string, unknown>, onConflict: string): Promise<void> {
  const r: Record<string, unknown> = { ...row }
  for (let i = 0; i < 6; i++) {
    const { error } = await admin.from(table).upsert(r, { onConflict })
    if (!error) return
    const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
    if (col && col in r) { delete r[col]; continue }
    throw new Error(error.message)
  }
}

type Row = {
  rowId: string; kind: 'eenmalig' | 'recurring'; sourceId: string; month: string
  client_id: string | null; service_slug: string | null; description: string | null
  amount_excl: number; vat_pct: number; amount_incl: number; status: string; revenue_id: string | null
  billing_date: string; clickup_task_id: string | null
  recurring_start: string | null; recurring_end: string | null; invoice_day: string | null
  contract_id: string | null; contract_title: string | null
  /** 'client' = onze omzet; setter_hours/setter_commission = een afrekening
   *  die een appointment setter ONS stuurt. */
  invoiceKind: string
  setterName: string | null
  /** Kosten en winst (intern): directe kosten, werkelijke winst, status. */
  kosten?: KostenSamenvatting
}
type KostenSamenvatting = {
  directeKosten: number; winst: number; margePct: number | null; vestingWaarde: number; nietMeetellend: number
  status: KostenStatus; aantalKosten: number; kostenOnbekend: number; waarschuwingen: string[]
  details: { omschrijving: string; categorie: string | null; leverancier: string | null; kostprijs_excl: number | null; lijn: string | null; datum: string | null; status: string; bewijs_url: string | null }[]
}

// GET ?month=YYYY-MM → samengevoegde facturen (eenmalig + recurring) + omzet + klanten
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const month = req.nextUrl.searchParams.get('month')
    if (!month) return NextResponse.json({ error: 'month vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()

    // Dit scherm is onze UITGAANDE facturatie — wat wij aan klanten sturen, en
    // dus onze omzet. Wat een appointment setter ONS factureert hoort hier niet
    // tussen; dat staat bij Verkoop → Resultaten en telt mee als kost.
    // Eerder gemaakte automatische regels ruimen we hier eenmalig op.
    await removeAutoSetterInvoices()

    const [{ data: invoices }, { data: recurring }, { data: recMonths }, { data: revenue }, { data: clients }] = await Promise.all([
      admin.from('invoices').select('*').eq('invoice_month', month),
      admin.from('recurring_invoices').select('*'),
      admin.from('recurring_invoice_months').select('*').eq('month', month),
      admin.from('revenue_entries').select('*'),
      admin.from('clients').select('id, company_name').is('archived_at', null).order('company_name'),
    ])

    // Contracttitels voor gekoppelde facturen (best-effort).
    const contractTitles = new Map<string, string>()
    try {
      const cids = Array.from(new Set(((invoices ?? []) as Record<string, unknown>[]).map((i) => i.contract_id).filter(Boolean))) as string[]
      if (cids.length > 0) {
        const { data: cts } = await admin.from('contracts').select('id, title').in('id', cids)
        for (const c of (cts ?? []) as { id: string; title: string }[]) contractTitles.set(c.id, c.title)
      }
    } catch { /* kolom kan ontbreken vóór migratie */ }

    // Namen van de setters, om te tonen van wie een afrekening komt.
    const setterNames = new Map<string, string>()
    try {
      const sids = Array.from(new Set(((invoices ?? []) as Record<string, unknown>[])
        .map((i) => i.setter_id).filter(Boolean))) as string[]
      if (sids.length > 0) {
        const { data: st } = await admin.from('sales_setters').select('id, name').in('id', sids)
        for (const x of (st ?? []) as { id: string; name: string }[]) setterNames.set(x.id, x.name)
      }
    } catch { /* kolom of tabel kan ontbreken vóór migratie */ }

    const rows: Row[] = []
    for (const i of (invoices ?? []) as Record<string, unknown>[]) {
      rows.push({
        rowId: `one:${i.id}`, kind: 'eenmalig', sourceId: i.id as string, month,
        client_id: (i.client_id ?? null) as string | null, service_slug: (i.service_slug ?? null) as string | null,
        description: (i.description ?? null) as string | null, amount_excl: Number(i.amount_excl), vat_pct: Number(i.vat_pct),
        amount_incl: Number(i.amount_incl), status: normalizeInvoiceStatus(i.status as string), revenue_id: (i.revenue_id ?? null) as string | null,
        billing_date: (i.invoice_date as string | null) ?? lastDayOfMonth(month), clickup_task_id: (i.clickup_task_id ?? null) as string | null,
        recurring_start: null, recurring_end: null, invoice_day: null,
        contract_id: (i.contract_id ?? null) as string | null,
        contract_title: i.contract_id ? (contractTitles.get(i.contract_id as string) ?? null) : null,
        invoiceKind: (i.kind as string | null) ?? 'client',
        setterName: i.setter_id ? (setterNames.get(i.setter_id as string) ?? null) : null,
      })
    }
    const recRow = new Map((recMonths ?? []).map((m: { recurring_id: string; status: string; clickup_task_id: string | null; billing_date?: string | null }) => [m.recurring_id, m]))
    for (const r of (recurring ?? []) as RecurringInvoice[]) {
      if (!recurringActiveInMonth(r, month)) continue
      const mr = recRow.get(r.id)
      rows.push({
        rowId: `rec:${r.id}:${month}`, kind: 'recurring', sourceId: r.id, month,
        client_id: r.client_id, service_slug: r.service_slug, description: r.description,
        amount_excl: Number(r.amount_excl), vat_pct: Number(r.vat_pct), amount_incl: Number(r.amount_incl),
        status: normalizeInvoiceStatus(mr?.status ?? 'te_versturen'), revenue_id: r.revenue_id,
        // Een verplaatste maand heeft haar eigen datum; anders de vaste factuurdag.
        billing_date: (mr?.billing_date ?? '').slice(0, 10) || billingDateFor(month, r.invoice_day), clickup_task_id: mr?.clickup_task_id ?? null,
        recurring_start: (r.start_month ?? '').slice(0, 7) || null, recurring_end: r.end_month ? r.end_month.slice(0, 7) : null, invoice_day: r.invoice_day ?? 'last',
        // Terugkerende facturen zijn altijd klantfacturen.
        invoiceKind: 'client', setterName: null,
        contract_id: null, contract_title: null,
      })
    }

    // Kosten en winst per rij (intern). Best-effort: de tabellen kunnen nog
    // niet gemigreerd zijn; dan blijft de lijst gewoon zonder kostenlaag.
    try {
      const per = await kostenPerFactuur(admin,
        rows.filter((r) => r.kind === 'eenmalig').map((r) => r.sourceId),
        rows.filter((r) => r.kind === 'recurring').map((r) => ({ recurring_id: r.sourceId, maand: r.month })))
      for (const r of rows) {
        const f = per.get(r.rowId)
        if (!f) continue
        const lijnNaam = new Map(f.lijnen.map((l) => [l.id, l.omschrijving]))
        r.kosten = {
          directeKosten: f.berekend.directeKosten, winst: f.berekend.winst, margePct: f.berekend.margePct, vestingWaarde: f.berekend.vestingWaarde, nietMeetellend: f.berekend.nietMeetellend,
          status: f.berekend.status, aantalKosten: f.berekend.aantalKosten, kostenOnbekend: f.berekend.kostenOnbekend, waarschuwingen: f.berekend.waarschuwingen,
          details: f.kosten.map((k) => ({ omschrijving: k.omschrijving, categorie: k.categorie, leverancier: k.leverancier, kostprijs_excl: k.kostprijs_excl, lijn: k.line_id ? (lijnNaam.get(k.line_id) ?? null) : null, datum: k.datum, status: k.status, bewijs_url: k.bewijs_url })),
        }
      }
    } catch { /* kostenlaag nog niet beschikbaar */ }

    const omzet = expandRevenueForMonth((revenue ?? []) as RevenueEntry[], month)
    const omzetExcl = omzet.reduce((s, x) => s + x.amount_excl, 0)

    // Prognoses bestaan niet meer; de voortgang van een maand is nu simpelweg
    // hoeveel van de facturen effectief verstuurd is.
    const live = rows.filter((r) => r.status !== 'geannuleerd')
    const openExcl = live.filter((r) => r.status !== 'verstuurd').reduce((s, r) => s + r.amount_excl, 0)
    const doneExcl = live.filter((r) => r.status === 'verstuurd').reduce((s, r) => s + r.amount_excl, 0)
    const totalExcl = openExcl + doneExcl
    const pct = totalExcl > 0 ? Math.round((doneExcl / totalExcl) * 100) : (live.length === 0 ? 0 : 100)

    return NextResponse.json({
      rows, omzet, clients: clients ?? [],
      summary: { omzetExcl, openExcl, doneExcl, linkedExcl: doneExcl, verschil: openExcl, pct },
      billingDate: lastDayOfMonth(month),
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    const admin = createAdminSupabaseClient()
    const vat = b.vat_pct != null ? Number(b.vat_pct) : DEFAULT_VAT
    const excl = Number(b.amount_excl) || 0

    // Eenmalige factuur
    if (b.action === 'one_time') {
      const month = String(b.invoice_month || '').slice(0, 7)
      if (!/^\d{4}-\d{2}$/.test(month)) return NextResponse.json({ error: 'Factuurmaand vereist' }, { status: 400 })
      const invoiceDate = b.invoice_date || lastDayOfMonth(month)
      // Automatische prognose-koppeling (link bestaande of maak nieuwe aan).
      const revenueId = b.revenue_id || await linkOrCreateForecast(admin, { client_id: b.client_id || null, service_slug: b.service_slug || null, month, amount_excl: excl, description: b.description || null, recurring: false })
      const incl = inclFromExcl(excl, vat)
      const status = INVOICE_STATUSES.includes(b.status) ? b.status : 'te_versturen'
      const id = await safeInsertId(admin, 'invoices', {
        client_id: b.client_id || null, service_slug: b.service_slug || null, invoice_month: month,
        invoice_date: invoiceDate, description: b.description || null,
        amount_excl: excl, vat_pct: vat, amount_incl: incl,
        status, revenue_id: revenueId, created_by: actor.id,
        contract_id: b.contract_id || null, contract_bedrag_excl: excl, currency: 'EUR',
      })
      // Interne factuurlijnen (classificatie/kostprijs) uit het formulier — best-effort.
      await slaLijnenOp(admin, { invoice_id: id }, b.lines, actor)
      // Ook prognose/omzet + klant-hub verversen zodat een auto-aangemaakte prognose direct zichtbaar is.
      try {
        revalidatePath('/admin/invoices'); revalidatePath('/admin/revenue/omzet'); revalidatePath('/admin/revenue')
        if (b.client_id) revalidatePath(`/admin/clients/${b.client_id}`)
      } catch { }
      return NextResponse.json({ id, revenue_id: revenueId, warning: null })
    }

    // Factuur met regels (uit de factuureditor: planner, contractdetail of Facturen).
    if (b.action === 'aanmaken') {
      const mag = await magIk('invoices', 'toevoegen')
      if (!mag) return NextResponse.json({ error: 'Je hebt geen recht om facturen aan te maken.' }, { status: 403 })
      const invoiceDate = typeof b.invoice_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.invoice_date) ? b.invoice_date : null
      if (!invoiceDate) return NextResponse.json({ error: 'Geplande factuurdatum vereist' }, { status: 400 })
      if (!b.client_id) return NextResponse.json({ error: 'Selecteer een klant voor deze factuur.' }, { status: 400 })
      const btw = b.vat_pct != null ? Number(b.vat_pct) : DEFAULT_VAT
      let regels = normaliseerRegels(b.regels, btw)
      if (regels.length === 0 && excl > 0) regels = [regelUitBedrag(String(b.description || 'Factuur'), excl, btw)]
      if (regels.length === 0) return NextResponse.json({ error: 'Voeg minstens één factuurregel toe.' }, { status: 400 })
      const t = berekenTotalen(regels)
      if (t.excl <= 0) return NextResponse.json({ error: 'Het factuurbedrag moet groter zijn dan nul.' }, { status: 400 })
      if (b.contract_id) { const { data: c } = await admin.from('contracts').select('id').eq('id', String(b.contract_id)).maybeSingle(); if (!c) return NextResponse.json({ error: 'Contract niet gevonden.' }, { status: 400 }) }
      const month = invoiceDate.slice(0, 7)
      const termijn = b.payment_term_days != null && Number.isFinite(Number(b.payment_term_days)) ? Math.max(0, Math.round(Number(b.payment_term_days))) : 30
      const vervaldatum = typeof b.due_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.due_date) ? b.due_date : (() => { const d = new Date(invoiceDate + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + termijn); return d.toISOString().slice(0, 10) })()
      const revenueId = b.revenue_id || await linkOrCreateForecast(admin, { client_id: b.client_id || null, service_slug: b.service_slug || null, month, amount_excl: t.excl, description: b.description || null, recurring: false })
      const id = await safeInsertId(admin, 'invoices', {
        client_id: b.client_id, service_slug: b.service_slug || null, invoice_month: month, invoice_date: invoiceDate, periode: b.periode || month,
        description: b.description || regels[0].omschrijving, amount_excl: t.excl, vat_pct: t.perBtw.length === 1 ? t.perBtw[0].pct : btw, amount_incl: t.incl,
        status: 'te_versturen', revenue_id: revenueId, created_by: actor.id, contract_id: b.contract_id || null,
        contract_bedrag_excl: t.contractueel.excl, currency: 'EUR', due_date: vervaldatum, payment_term_days: termijn, reference: b.reference || null, note: b.note || null,
        kind: 'client', source: b.contract_id ? 'contract' : 'handmatig', betaalstatus: 'niet_betaald', betaald_bedrag: 0,
      })
      const { error: le } = await admin.from('invoice_lines').insert(regels.map((r) => ({
        invoice_id: id, volgnr: r.volgnr, omschrijving: r.omschrijving, artikel: r.artikel, aantal: r.aantal, eenheid: r.eenheid,
        prijs_excl: r.prijs_excl, btw_pct: r.btw_pct, korting_pct: r.korting_pct, is_extra: r.is_extra, classificatie: r.classificatie, opmerking: r.opmerking ?? null,
      })))
      if (le) throw new Error(le.message)
      try { await admin.from('invoice_wijzigingen').insert({ invoice_id: id, actie: 'aangemaakt', veld: null, oud: null, nieuw: `${regels.length} regel(s), € ${t.excl.toFixed(2)} excl. btw`, actor_email: actor.email ?? null }) } catch { /* */ }
      try {
        revalidatePath('/admin/invoices'); revalidatePath('/admin/invoices/planner'); revalidatePath('/admin/revenue/omzet')
        if (b.client_id) revalidatePath(`/admin/clients/${b.client_id}`)
        if (b.contract_id) revalidatePath(`/admin/contracts/${b.contract_id}`)
      } catch { }
      return NextResponse.json({ id, revenue_id: revenueId })
    }

    // Recurring factuur-definitie
    if (b.action === 'recurring') {
      const start = String(b.start_month || '').slice(0, 7)
      if (!/^\d{4}-\d{2}$/.test(start)) return NextResponse.json({ error: 'Startmaand vereist' }, { status: 400 })
      const end = b.end_month ? String(b.end_month).slice(0, 7) : null
      const invoiceDay = INVOICE_DAYS.includes(b.invoice_day) ? b.invoice_day : 'last'
      const revenueId = b.revenue_id || await linkOrCreateForecast(admin, { client_id: b.client_id || null, service_slug: b.service_slug || null, month: start, amount_excl: excl, description: b.description || null, recurring: true, start_month: start, end_month: end })
      const id = await safeInsertId(admin, 'recurring_invoices', {
        client_id: b.client_id || null, service_slug: b.service_slug || null,
        start_month: start, end_month: end, description: b.description || null,
        amount_excl: excl, vat_pct: vat, amount_incl: inclFromExcl(excl, vat),
        active: b.active !== false, revenue_id: revenueId, invoice_day: invoiceDay, created_by: actor.id,
        contract_id: b.contract_id || null, verantwoordelijke: b.verantwoordelijke ? String(b.verantwoordelijke).slice(0, 120) : null,
        payment_term_days: b.payment_term_days === undefined || b.payment_term_days === null || b.payment_term_days === '' ? null : Math.max(0, Math.round(Number(b.payment_term_days) || 30)),
      })
      await slaLijnenOp(admin, { recurring_id: id, maand: start }, b.lines, actor)
      try {
        revalidatePath('/admin/invoices'); revalidatePath('/admin/revenue/omzet'); revalidatePath('/admin/revenue')
        if (b.client_id) revalidatePath(`/admin/clients/${b.client_id}`)
      } catch { }
      return NextResponse.json({ id, revenue_id: revenueId })
    }

    // Status zetten (werkt voor beide types; recurring per maand)
    if (b.action === 'status') {
      const status = INVOICE_STATUSES.includes(b.status) ? b.status : 'te_versturen'
      if (b.kind === 'recurring') {
        if (!b.source_id || !b.month) return NextResponse.json({ error: 'source_id en month vereist' }, { status: 400 })
        const month = String(b.month).slice(0, 7)
        // Centrale helper: legt bij 'verstuurd' bedrag + factuurdatum vast als momentopname.
        const r = await zetMaandStatus(admin, b.source_id, month, status, { id: actor.id, email: actor.email ?? null })
        try { revalidatePath('/admin/invoices'); revalidatePath('/admin/invoices/planner') } catch { }
        return NextResponse.json({ ok: true, warning: r.warning })
      } else {
        if (!b.source_id) return NextResponse.json({ error: 'source_id vereist' }, { status: 400 })
        const { data: inv } = await admin.from('invoices').select('id, status, sent_at').eq('id', b.source_id).maybeSingle()
        const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() }
        if (status === 'verstuurd') { patch.sent_at = inv?.sent_at ?? new Date().toISOString(); patch.sent_by_email = actor.email ?? null }
        if (status === 'te_versturen') { patch.sent_at = null; patch.sent_by_email = null }
        const { error } = await admin.from('invoices').update(patch).eq('id', b.source_id)
        if (error) throw new Error(error.message)
        try { await admin.from('invoice_wijzigingen').insert({ invoice_id: b.source_id, actie: status === 'verstuurd' ? 'verstuurd' : status === 'geannuleerd' ? 'geannuleerd' : 'aangepast', veld: 'status', oud: inv?.status ?? null, nieuw: status, actor_email: actor.email ?? null }) } catch { /* */ }
      }
      try { revalidatePath('/admin/invoices') } catch { }
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH { kind, id, ...velden } — eenmalige factuur of recurring-definitie bewerken/koppelen
export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const table = b.kind === 'recurring' ? 'recurring_invoices' : 'invoices'

    const patch: Record<string, unknown> = {}
    if (b.client_id !== undefined) patch.client_id = b.client_id || null
    if (b.service_slug !== undefined) patch.service_slug = b.service_slug || null
    if (b.description !== undefined) patch.description = b.description || null
    if (b.revenue_id !== undefined) patch.revenue_id = b.revenue_id || null
    if (b.kind === 'recurring') {
      if (b.start_month !== undefined) patch.start_month = String(b.start_month).slice(0, 7)
      if (b.end_month !== undefined) patch.end_month = b.end_month ? String(b.end_month).slice(0, 7) : null
      if (b.active !== undefined) patch.active = !!b.active
      if (b.invoice_day !== undefined) patch.invoice_day = INVOICE_DAYS.includes(b.invoice_day) ? b.invoice_day : 'last'
    } else {
      if (b.invoice_date !== undefined) {
        patch.invoice_date = b.invoice_date || null
        // De maand volgt de datum, anders staat de factuur in het verkeerde maandoverzicht.
        if (/^\d{4}-\d{2}-\d{2}/.test(String(b.invoice_date ?? ''))) patch.invoice_month = String(b.invoice_date).slice(0, 7)
      }
    }
    if (b.amount_excl !== undefined || b.vat_pct !== undefined) {
      const { data: cur } = await admin.from(table).select('amount_excl, vat_pct').eq('id', b.id).maybeSingle()
      const excl = b.amount_excl !== undefined ? Number(b.amount_excl) : Number(cur?.amount_excl ?? 0)
      const vat = b.vat_pct !== undefined ? Number(b.vat_pct) : Number(cur?.vat_pct ?? DEFAULT_VAT)
      patch.amount_excl = excl; patch.vat_pct = vat; patch.amount_incl = inclFromExcl(excl, vat)
    }
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })
    const { error } = await admin.from(table).update(patch).eq('id', b.id)
    if (error) throw new Error(error.message)
    // Terugkerend: enkel toekomstige, nog niet uitgevoerde maanden volgen de
    // wijziging (historiek heeft haar eigen momentopname).
    let maanden: { bijgewerkt: number; fouten: string[] } | null = null
    if (b.kind === 'recurring' && (b.invoice_day !== undefined || b.amount_excl !== undefined || b.vat_pct !== undefined || b.description !== undefined || b.client_id !== undefined)) {
      maanden = await werkToekomstigeMaandenBij(admin, b.id)
    }
    try { revalidatePath('/admin/invoices'); revalidatePath('/admin/invoices/planner') } catch { }
    return NextResponse.json({ ok: true, maanden })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?kind=&id=
export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id')
    const kind = req.nextUrl.searchParams.get('kind')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    if (kind === 'recurring') {
      // Nooit hard verwijderen: toekomstige maanden annuleren, historiek en
      // verstuurde facturen behouden, prognose stoppen.
      const meta = requestMeta(req)
      const r = await stopRecurring(admin, id, { id: actor.id, email: actor.email ?? null }, meta.ip, meta.userAgent)
      try { revalidatePath('/admin/invoices'); revalidatePath('/admin/invoices/planner'); revalidatePath('/admin/revenue/omzet') } catch { }
      return NextResponse.json(r)
    }
    // Eenmalige factuur wissen loopt via /api/admin/invoices/[id] (rechten + logboek).
    return NextResponse.json({ error: 'Verwijder een factuur via de factuur zelf (DELETE /api/admin/invoices/<id>).' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
