import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { id } = await params
    const body = await req.json()
    const { notes } = body

    const admin = createAdminSupabaseClient()

    // Fetch all pending ledger entries for this partner. select('*') so the
    // direction column is included without breaking on older schemas.
    const { data: entries, error: fetchErr } = await admin
      .from('partner_ledger_entries')
      .select('*')
      .eq('freelancer_id', id)
      .eq('status', 'pending')

    if (fetchErr) throw fetchErr

    if (!entries || entries.length === 0) {
      return NextResponse.json({ error: 'Geen openstaande items om af te rekenen' }, { status: 400 })
    }

    // Direction is explicit when present, else inferred from the amount sign.
    const dirOf = (e: { direction?: string | null; amount: number }) =>
      e.direction === 'partner_pays_us' || e.direction === 'we_pay_partner'
        ? e.direction
        : (Number(e.amount) >= 0 ? 'we_pay_partner' : 'partner_pays_us')

    const totalOwedToPartner = entries
      .filter((e) => dirOf(e) === 'we_pay_partner')
      .reduce((s, e) => s + Math.abs(Number(e.amount)), 0)
    const totalOwedByPartner = entries
      .filter((e) => dirOf(e) === 'partner_pays_us')
      .reduce((s, e) => s + Math.abs(Number(e.amount)), 0)
    const netAmount = totalOwedToPartner - totalOwedByPartner

    // Determine period from occurred_on dates
    const dates = entries.map((e) => e.occurred_on as string).sort()
    const periodStart = dates[0]
    const periodEnd = dates[dates.length - 1]

    // Create settlement record
    const { data: settlement, error: settlErr } = await admin
      .from('partner_settlements')
      .insert({
        freelancer_id: id,
        period_start: periodStart,
        period_end: periodEnd,
        total_owed_to_partner: totalOwedToPartner,
        total_owed_by_partner: totalOwedByPartner,
        net_amount: netAmount,
        status: 'draft',
        notes: notes || null,
        finalized_at: null,
        paid_at: null,
      })
      .select('*')
      .single()

    if (settlErr) throw settlErr

    // Mark all pending entries as settled and link to this settlement
    const entryIds = entries.map((e) => e.id)
    const { error: updateErr } = await admin
      .from('partner_ledger_entries')
      .update({ status: 'settled', settlement_id: settlement.id })
      .in('id', entryIds)

    if (updateErr) throw updateErr

    return NextResponse.json({ settlement })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — update a settlement's status (e.g. mark as paid)
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { id } = await params
    const { settlement_id, status } = await req.json()
    if (!settlement_id) return NextResponse.json({ error: 'settlement_id vereist' }, { status: 400 })
    if (!['draft', 'finalized', 'paid'].includes(status)) {
      return NextResponse.json({ error: 'Ongeldige status' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()

    // Scope to this partner so one partner's settlement can't be touched via another.
    const { data: existing } = await admin
      .from('partner_settlements')
      .select('id')
      .eq('id', settlement_id)
      .eq('freelancer_id', id)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Afrekening niet gevonden' }, { status: 404 })

    const nowIso = new Date().toISOString()
    const patch: Record<string, unknown> = { status }
    if (status === 'paid') { patch.paid_at = nowIso; patch.finalized_at = nowIso }
    if (status === 'finalized') patch.finalized_at = nowIso

    const { error } = await admin.from('partner_settlements').update(patch).eq('id', settlement_id)
    if (error) throw error

    const meta = requestMeta(req)
    await logAudit({
      action: 'settlement.status.update',
      entityType: 'settlement',
      entityId: settlement_id,
      summary: `Afrekening status → ${status}`,
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      actorRole: 'admin',
      metadata: { partner_id: id, status },
      ip: meta.ip,
      userAgent: meta.userAgent,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — remove a settlement. Only allowed once it has been marked paid.
// The ledger entries that were rolled into this (paid) settlement are removed
// with it, so they don't linger as orphaned "settled" rows.
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { id } = await params
    const settlementId = req.nextUrl.searchParams.get('settlement_id')
    if (!settlementId) return NextResponse.json({ error: 'settlement_id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()

    const { data: existing } = await admin
      .from('partner_settlements')
      .select('*')
      .eq('id', settlementId)
      .eq('freelancer_id', id)
      .maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Afrekening niet gevonden' }, { status: 404 })

    if (existing.status !== 'paid') {
      return NextResponse.json(
        { error: 'Alleen afrekeningen met status "Betaald" kunnen verwijderd worden. Markeer deze eerst als betaald.' },
        { status: 400 },
      )
    }

    // Remove the ledger entries that belonged to this paid settlement, then the
    // settlement itself.
    try { await admin.from('partner_ledger_entries').delete().eq('settlement_id', settlementId) } catch { }
    const { error } = await admin.from('partner_settlements').delete().eq('id', settlementId)
    if (error) throw error

    const meta = requestMeta(req)
    await logAudit({
      action: 'settlement.delete',
      entityType: 'settlement',
      entityId: settlementId,
      summary: 'Betaalde afrekening verwijderd (incl. gekoppelde ledgerposten)',
      actorUserId: user.id,
      actorEmail: user.email ?? null,
      actorRole: 'admin',
      metadata: { partner_id: id, net_amount: existing.net_amount ?? null },
      ip: meta.ip,
      userAgent: meta.userAgent,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
