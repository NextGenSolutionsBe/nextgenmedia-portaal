import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesGetal } from '@/lib/getal'
import { INVOICE_DAYS, DEFAULT_VAT, inclFromExcl } from '@/lib/invoices'
import { stopRecurring } from '@/lib/facturatie/recurring'

export const dynamic = 'force-dynamic'

const YM = /^\d{4}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ververs = (clientId?: string | null) => {
  try {
    revalidatePath('/admin/invoices'); revalidatePath('/admin/invoices/planner'); revalidatePath('/admin/revenue'); revalidatePath('/admin/revenue/omzet')
    if (clientId) revalidatePath(`/admin/clients/${clientId}`)
  } catch { /* */ }
}

/** GET — de terugkerende facturatie met keuzelijsten, om ze te bewerken. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const [{ data: rec }, { data: maanden }, { data: klanten }, { data: contracten }] = await Promise.all([
      admin.from('recurring_invoices').select('*').eq('id', id).maybeSingle(),
      admin.from('recurring_invoice_months').select('month, status, invoice_id').eq('recurring_id', id),
      admin.from('clients').select('id, company_name').order('company_name').limit(2000),
      admin.from('contracts').select('id, title, client_id').order('created_at', { ascending: false }).limit(1000),
    ])
    if (!rec) return NextResponse.json({ error: 'Terugkerende facturatie niet gevonden' }, { status: 404 })
    const uitgevoerd = (maanden ?? []).filter((m) => m.status === 'verstuurd' || m.status === 'betaald' || m.invoice_id).length
    return NextResponse.json({ reeks: rec, uitgevoerd, klanten: klanten ?? [], contracten: contracten ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * PATCH — alle velden van een terugkerende facturatie aanpassen: klant,
 * contract, dienst, omschrijving, bedrag, btw, start- en eindmaand, factuurdag,
 * verantwoordelijke en betaaltermijn. Verstuurde maanden behouden hun eigen
 * momentopname; de rest volgt de nieuwe waarden.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: oud } = await admin.from('recurring_invoices').select('*').eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Terugkerende facturatie niet gevonden' }, { status: 404 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const heeft = (k: string) => Object.prototype.hasOwnProperty.call(b, k)
    const tekst = (v: unknown, max = 500) => { const s = String(v ?? '').trim(); return s ? s.slice(0, max) : null }
    const patch: Record<string, unknown> = {}

    if (heeft('client_id')) patch.client_id = UUID.test(String(b.client_id ?? '')) ? b.client_id : null
    if (heeft('contract_id')) patch.contract_id = UUID.test(String(b.contract_id ?? '')) ? b.contract_id : null
    if (heeft('service_slug')) patch.service_slug = tekst(b.service_slug, 100)
    if (heeft('description')) patch.description = tekst(b.description, 2000)
    if (heeft('verantwoordelijke')) patch.verantwoordelijke = tekst(b.verantwoordelijke, 120)
    if (heeft('payment_term_days')) {
      const d = b.payment_term_days === '' || b.payment_term_days == null ? null : leesGetal(b.payment_term_days)
      if (d !== null && (d < 0 || d > 365)) return NextResponse.json({ error: 'Betaaltermijn moet tussen 0 en 365 dagen liggen.' }, { status: 400 })
      patch.payment_term_days = d === null ? null : Math.round(d)
    }
    if (heeft('invoice_day')) patch.invoice_day = (INVOICE_DAYS as readonly string[]).includes(String(b.invoice_day)) ? b.invoice_day : 'last'
    if (heeft('start_month')) {
      const s = String(b.start_month ?? '').slice(0, 7)
      if (!YM.test(s)) return NextResponse.json({ error: 'Kies een geldige startmaand.' }, { status: 400 })
      patch.start_month = s
    }
    if (heeft('end_month')) {
      const e = b.end_month ? String(b.end_month).slice(0, 7) : null
      if (e && !YM.test(e)) return NextResponse.json({ error: 'Kies een geldige eindmaand.' }, { status: 400 })
      patch.end_month = e
    }
    const start = String(patch.start_month ?? oud.start_month ?? '').slice(0, 7)
    const eind = (heeft('end_month') ? patch.end_month : oud.end_month) as string | null
    if (eind && start && eind.slice(0, 7) < start) return NextResponse.json({ error: 'De eindmaand ligt vóór de startmaand.' }, { status: 400 })
    if (heeft('amount_excl') || heeft('vat_pct')) {
      const excl = heeft('amount_excl') ? leesGetal(b.amount_excl) : Number(oud.amount_excl)
      const vat = heeft('vat_pct') ? leesGetal(b.vat_pct) : Number(oud.vat_pct ?? DEFAULT_VAT)
      if (excl === null || !Number.isFinite(excl) || excl < 0) return NextResponse.json({ error: 'Geef een geldig bedrag (bv. 1250,50).' }, { status: 400 })
      if (vat === null || vat < 0 || vat > 100) return NextResponse.json({ error: 'Btw moet tussen 0 en 100 % liggen.' }, { status: 400 })
      patch.amount_excl = excl; patch.vat_pct = vat; patch.amount_incl = inclFromExcl(excl, vat)
    }
    if (heeft('active')) patch.active = !!b.active
    if (!Object.keys(patch).length) return NextResponse.json({ ok: true })
    patch.updated_at = new Date().toISOString()
    const { error } = await admin.from('recurring_invoices').update(patch).eq('id', id)
    if (error) throw new Error(error.message)

    const oudeWaarden = Object.fromEntries(Object.keys(patch).filter((k) => k !== 'updated_at').map((k) => [k, (oud as Record<string, unknown>)[k] ?? null]))
    const meta = requestMeta(req)
    await logAudit({
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'staff', action: 'recurring_gewijzigd', entityType: 'recurring_invoice', entityId: id,
      summary: `Terugkerende facturatie aangepast (${Object.keys(oudeWaarden).join(', ')})`, metadata: { oud: oudeWaarden, nieuw: patch }, ip: meta.ip, userAgent: meta.userAgent,
    }).catch(() => {})
    ververs((patch.client_id as string | null) ?? oud.client_id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * DELETE — standaard STOPZETTEN (toekomstige maanden geannuleerd, historiek blijft).
 * DELETE ?definitief=1 — volledig verwijderen, enkel zolang er nog geen maand
 * verstuurd, betaald of aan een factuur gekoppeld is. De bijhorende lijnen,
 * kosten en de automatisch aangemaakte prognose gaan mee.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const meta = requestMeta(req)
    const { data: rec } = await admin.from('recurring_invoices').select('*').eq('id', id).maybeSingle()
    if (!rec) return NextResponse.json({ error: 'Terugkerende facturatie niet gevonden' }, { status: 404 })

    if (req.nextUrl.searchParams.get('definitief') !== '1') {
      const r = await stopRecurring(admin, id, { id: actor.id, email: actor.email ?? null }, meta.ip, meta.userAgent)
      ververs(rec.client_id)
      return NextResponse.json(r)
    }

    const { data: maanden } = await admin.from('recurring_invoice_months').select('month, status, invoice_id').eq('recurring_id', id)
    const uitgevoerd = (maanden ?? []).filter((m) => m.status === 'verstuurd' || m.status === 'betaald' || m.invoice_id)
    if (uitgevoerd.length) {
      return NextResponse.json({ error: `Er zijn al ${uitgevoerd.length} maand(en) verstuurd of gefactureerd. Die horen in de historiek: zet de reeks stop in plaats van ze te verwijderen.` }, { status: 409 })
    }
    await admin.from('invoice_costs').delete().eq('recurring_id', id)
    await admin.from('invoice_lines').delete().eq('recurring_id', id)
    await admin.from('recurring_invoice_months').delete().eq('recurring_id', id)
    const { error } = await admin.from('recurring_invoices').delete().eq('id', id)
    if (error) throw new Error(error.message)
    // De prognose die er automatisch bij aangemaakt werd, enkel als niets anders ze gebruikt.
    if (rec.revenue_id) {
      const [{ count: a }, { count: c }] = await Promise.all([
        admin.from('invoices').select('id', { count: 'exact', head: true }).eq('revenue_id', rec.revenue_id),
        admin.from('recurring_invoices').select('id', { count: 'exact', head: true }).eq('revenue_id', rec.revenue_id),
      ])
      if (!a && !c) await admin.from('revenue_entries').delete().eq('id', rec.revenue_id)
    }
    await logAudit({
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'staff', action: 'recurring_verwijderd', entityType: 'recurring_invoice', entityId: id,
      summary: `Terugkerende facturatie definitief verwijderd (${rec.description ?? rec.service_slug ?? id})`, metadata: { oud: rec }, ip: meta.ip, userAgent: meta.userAgent,
    }).catch(() => {})
    ververs(rec.client_id)
    return NextResponse.json({ ok: true, verwijderd: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
