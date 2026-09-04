import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import {
  inclFromExcl, lastDayOfMonth, billingDateFor, expandRevenueForMonth, normalizeInvoiceStatus,
  recurringActiveInMonth, INVOICE_STATUSES, INVOICE_DAYS, DEFAULT_VAT, type RevenueEntry, type RecurringInvoice,
} from '@/lib/invoices'
import { removeAutoSetterInvoices } from '@/lib/sales/setter-invoices'
import { createInvoiceTask, completeInvoiceTask, clickupConfigured, INVOICE_ASSIGNEE_NAME } from '@/lib/clickup'

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

async function clientNameFor(admin: Admin, clientId: string | null): Promise<string> {
  if (!clientId) return 'Onbekende klant'
  try { const { data } = await admin.from('clients').select('company_name').eq('id', clientId).maybeSingle(); return data?.company_name ?? 'Onbekende klant' } catch { return 'Onbekende klant' }
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
    const recRow = new Map((recMonths ?? []).map((m: { recurring_id: string; status: string; clickup_task_id: string | null }) => [m.recurring_id, m]))
    for (const r of (recurring ?? []) as RecurringInvoice[]) {
      if (!recurringActiveInMonth(r, month)) continue
      const mr = recRow.get(r.id)
      rows.push({
        rowId: `rec:${r.id}:${month}`, kind: 'recurring', sourceId: r.id, month,
        client_id: r.client_id, service_slug: r.service_slug, description: r.description,
        amount_excl: Number(r.amount_excl), vat_pct: Number(r.vat_pct), amount_incl: Number(r.amount_incl),
        status: normalizeInvoiceStatus(mr?.status ?? 'te_versturen'), revenue_id: r.revenue_id,
        billing_date: billingDateFor(month, r.invoice_day), clickup_task_id: mr?.clickup_task_id ?? null,
        recurring_start: (r.start_month ?? '').slice(0, 7) || null, recurring_end: r.end_month ? r.end_month.slice(0, 7) : null, invoice_day: r.invoice_day ?? 'last',
        // Terugkerende facturen zijn altijd klantfacturen.
        invoiceKind: 'client', setterName: null,
        contract_id: null, contract_title: null,
      })
    }

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
      clickup_enabled: clickupConfigured(),
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
      // ClickUp-taak "Factuur versturen — [klant]" (best-effort).
      const clientName = await clientNameFor(admin, b.client_id || null)
      const task = await createInvoiceTask({ clientName, amountIncl: incl, invoiceDate, type: 'Eenmalig' })
      const id = await safeInsertId(admin, 'invoices', {
        client_id: b.client_id || null, service_slug: b.service_slug || null, invoice_month: month,
        invoice_date: invoiceDate, description: b.description || null,
        amount_excl: excl, vat_pct: vat, amount_incl: incl,
        status, revenue_id: revenueId, created_by: actor.id, clickup_task_id: task.taskId,
        contract_id: b.contract_id || null,
      })
      // Meteen verstuurd aangemaakt? → taak ook afronden.
      if (status === 'verstuurd' && task.taskId) await completeInvoiceTask(task.taskId)
      // Ook prognose/omzet + klant-hub verversen zodat een auto-aangemaakte prognose direct zichtbaar is.
      try {
        revalidatePath('/admin/invoices'); revalidatePath('/admin/revenue/omzet'); revalidatePath('/admin/revenue')
        if (b.client_id) revalidatePath(`/admin/clients/${b.client_id}`)
      } catch { }
      return NextResponse.json({ id, revenue_id: revenueId, warning: task.assigneeFound ? null : `ClickUp-gebruiker "${INVOICE_ASSIGNEE_NAME}" niet gevonden — taak zonder verantwoordelijke aangemaakt.` })
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
      })
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
        const { data: existing } = await admin.from('recurring_invoice_months').select('*').eq('recurring_id', b.source_id).eq('month', month).maybeSingle()
        let taskId: string | null = existing?.clickup_task_id ?? null
        // ClickUp-taak aanmaken zodra deze maand opgevolgd wordt; afronden bij 'verstuurd'.
        const { data: rec } = await admin.from('recurring_invoices').select('*').eq('id', b.source_id).maybeSingle()
        let assigneeWarning: string | null = null
        if (!taskId && rec) {
          const clientName = await clientNameFor(admin, rec.client_id ?? null)
          const task = await createInvoiceTask({ clientName, amountIncl: Number(rec.amount_incl) || 0, invoiceDate: billingDateFor(month, rec.invoice_day), type: 'Recurring' })
          taskId = task.taskId
          if (!task.assigneeFound) assigneeWarning = `ClickUp-gebruiker "${INVOICE_ASSIGNEE_NAME}" niet gevonden — taak zonder verantwoordelijke aangemaakt.`
        }
        await safeUpsert(admin, 'recurring_invoice_months', { recurring_id: b.source_id, month, status, clickup_task_id: taskId }, 'recurring_id,month')
        if (status === 'verstuurd' && taskId) await completeInvoiceTask(taskId)
        try { revalidatePath('/admin/invoices') } catch { }
        return NextResponse.json({ ok: true, warning: assigneeWarning })
      } else {
        if (!b.source_id) return NextResponse.json({ error: 'source_id vereist' }, { status: 400 })
        const { data: inv } = await admin.from('invoices').select('*').eq('id', b.source_id).maybeSingle()
        const { error } = await admin.from('invoices').update({ status }).eq('id', b.source_id)
        if (error) throw new Error(error.message)
        if (status === 'verstuurd' && inv?.clickup_task_id) await completeInvoiceTask(inv.clickup_task_id)
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
      if (b.invoice_date !== undefined) patch.invoice_date = b.invoice_date || null
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
    try { revalidatePath('/admin/invoices') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?kind=&id=
export async function DELETE(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id')
    const kind = req.nextUrl.searchParams.get('kind')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const table = kind === 'recurring' ? 'recurring_invoices' : 'invoices'
    const { error } = await admin.from(table).delete().eq('id', id)
    if (error) throw new Error(error.message)
    try { revalidatePath('/admin/invoices') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
