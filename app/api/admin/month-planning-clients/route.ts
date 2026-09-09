import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { MONTH_CLIENT_TYPE_KEYS } from '@/lib/month-phases'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// Klanten per maand: één rij per klant per maand. `planning_type` = 'new' of
// 'existing'. (De kolom `phase` bestaat nog in de tabel maar wordt vast op
// 'maand' gezet — er is geen koppeling per activiteit meer.)

// GET ?month=YYYY-MM  of  ?client_id=<uuid>
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const month = req.nextUrl.searchParams.get('month')
    const clientId = req.nextUrl.searchParams.get('client_id')
    const admin = createAdminSupabaseClient()
    let q = admin.from('month_planning_clients').select('*')
    if (month) q = q.eq('plan_month', month).order('created_at', { ascending: true })
    else if (clientId) q = q.eq('client_id', clientId).order('plan_month', { ascending: true })
    else return NextResponse.json({ error: 'month of client_id vereist' }, { status: 400 })
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return NextResponse.json({ entries: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST { plan_month, client_id, planning_type, note? }
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    if (!b.plan_month || !b.client_id) return NextResponse.json({ error: 'plan_month en client_id vereist' }, { status: 400 })
    const type = MONTH_CLIENT_TYPE_KEYS.includes(b.planning_type) ? b.planning_type : 'new'
    const admin = createAdminSupabaseClient()

    // Geen dubbele koppeling van dezelfde klant in dezelfde maand.
    const { data: existing } = await admin.from('month_planning_clients')
      .select('id').eq('plan_month', String(b.plan_month).slice(0, 7)).eq('client_id', b.client_id).maybeSingle()
    if (existing) return NextResponse.json({ error: 'Klant staat al in deze maand' }, { status: 400 })

    const { data, error } = await admin.from('month_planning_clients').insert({
      plan_month: String(b.plan_month).slice(0, 7),
      client_id: b.client_id,
      phase: 'maand',
      planning_type: type,
      note: b.note || null,
      created_by: actor.id,
    }).select('id').single()
    if (error) throw new Error(error.message)
    return NextResponse.json({ id: data.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH { id, planning_type?, note? }
export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const patch: Record<string, unknown> = {}
    if (b.planning_type !== undefined) patch.planning_type = MONTH_CLIENT_TYPE_KEYS.includes(b.planning_type) ? b.planning_type : 'new'
    if (b.note !== undefined) patch.note = b.note || null
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('month_planning_clients').update(patch).eq('id', b.id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?id=
export async function DELETE(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('month_planning_clients').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
