import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient, insertResilient , isActiveStaff } from '@/lib/supabase/server'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

const VALID_KINDS = ['commission_owed', 'payout_owed', 'service_billed', 'manual_credit', 'manual_debit']

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { id } = await params
    const body = await req.json()
    const { kind, amount, client_id, description, occurred_on } = body

    if (!VALID_KINDS.includes(kind)) {
      return NextResponse.json({ error: 'Ongeldig type' }, { status: 400 })
    }
    if (amount === undefined || amount === null || isNaN(Number(amount))) {
      return NextResponse.json({ error: 'Bedrag is verplicht' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()

    // Verify partner exists
    const { data: partner } = await admin.from('freelancers').select('id').eq('id', id).maybeSingle()
    if (!partner) return NextResponse.json({ error: 'Partner niet gevonden' }, { status: 404 })

    // Direction is explicit: positive amount = we pay the partner,
    // negative amount = partner pays us. Allow an explicit override too.
    const numAmount = Number(amount)
    const direction: string = body.direction === 'partner_pays_us' || body.direction === 'we_pay_partner'
      ? body.direction
      : (numAmount >= 0 ? 'we_pay_partner' : 'partner_pays_us')

    const { data, error } = await insertResilient(
      admin,
      'partner_ledger_entries',
      {
        freelancer_id: id,
        kind,
        amount: numAmount,
        direction,
        client_id: client_id || null,
        description: description || null,
        occurred_on: occurred_on || new Date().toISOString().slice(0, 10),
        status: 'pending',
      },
      { select: '*', required: ['freelancer_id', 'amount'] },
    )

    if (error) throw new Error(error.message)
    return NextResponse.json({ entry: data })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
