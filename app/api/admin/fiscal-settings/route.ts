import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

const NUM_FIELDS = [
  'corporate_tax_pct', 'reduced_tax_pct', 'reduced_tax_limit',
  'social_pct_band1', 'social_pct_band2', 'income_band1_limit', 'income_band2_limit',
  'mgmt_fee_pct', 'min_quarter', 'max_quarter', 'extra_pct', 'extra_fixed',
  'salary_gross_monthly', 'salary_months',
  'vat_pct', 'cash_reserve_pct', 'cash_on_account', 'partner_draws',
] as const

export async function GET(req: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const year = Number(req.nextUrl.searchParams.get('year')) || new Date().getFullYear()
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('fiscal_settings').select('*').eq('year', year).maybeSingle()
    if (error) throw error
    return NextResponse.json({ settings: data ?? null })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const body = await req.json()
    const year = Number(body.year)
    if (!year) return NextResponse.json({ error: 'year vereist' }, { status: 400 })

    const row: Record<string, unknown> = { year, updated_by: actor.id, updated_at: new Date().toISOString() }
    for (const f of NUM_FIELDS) if (body[f] !== undefined && body[f] !== '') row[f] = Number(body[f])
    if (body.statuut !== undefined) row.statuut = String(body.statuut)
    if (body.include_social_as_cost !== undefined) row.include_social_as_cost = Boolean(body.include_social_as_cost)

    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('fiscal_settings').upsert(row, { onConflict: 'year' })
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
