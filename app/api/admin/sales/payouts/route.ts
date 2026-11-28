import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { payoutsFor, statsFor, monthPeriod } from '@/lib/sales/setters'
import { monthKey } from '@/lib/sales/earnings'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * De twee maandafrekeningen per setter: uren en commissie.
 * ADMIN-ONLY — dit gaat over uitbetalen.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const m = req.nextUrl.searchParams.get('month')
    const base = m ? new Date(`${m}T12:00:00`) : new Date()
    const payouts = await payoutsFor(Number.isFinite(base.getTime()) ? base : new Date())
    return NextResponse.json({ payouts })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST { setterId, month, kind, paid } — een afrekening op betaald zetten.
 *
 * Het bedrag wordt op dat moment VASTGEZET. Een tijdregistratie die later nog
 * binnenkomt mag een al betaalde afrekening niet meer veranderen.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()

    const setterId = String(b.setterId ?? '')
    const kind = String(b.kind ?? '')
    const month = String(b.month ?? '')
    const paid = b.paid !== false
    if (!setterId || !['hours', 'commission'].includes(kind) || !/^\d{4}-\d{2}-01$/.test(month)) {
      return NextResponse.json({ error: 'Ongeldige afrekening' }, { status: 400 })
    }

    const period = monthPeriod(new Date(`${month}T12:00:00`))
    const stats = await statsFor(period, setterId)
    const s = stats[0]
    if (!s) return NextResponse.json({ error: 'Setter niet gevonden' }, { status: 404 })
    const amount = kind === 'hours' ? s.earnedCents : s.commissionCents

    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('sales_payouts').upsert({
      setter_id: setterId,
      month: monthKey(period.from),
      kind,
      amount_cents: amount,
      status: paid ? 'paid' : 'open',
      paid_at: paid ? new Date().toISOString() : null,
      paid_by: paid ? actor.id : null,
    }, { onConflict: 'setter_id,month,kind' })
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: paid ? 'sales.payout.paid' : 'sales.payout.reopen',
      entityType: 'sales_setter', entityId: setterId,
      summary: `Verkoop: afrekening ${kind === 'hours' ? 'uren' : 'commissie'} ${month} ${paid ? 'betaald' : 'heropend'}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true, amountCents: amount })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
