import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// Handmatige uitzonderingen op de automatische maandplanning. Per datum een
// lijst categorie-keys; lege lijst = dag bewust leeg; geen rij = standaard.

// GET ?from=YYYY-MM-DD&to=YYYY-MM-DD — overrides in een periode
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const from = req.nextUrl.searchParams.get('from')
    const to = req.nextUrl.searchParams.get('to')
    const admin = createAdminSupabaseClient()
    let q = admin.from('month_planning_overrides').select('plan_date, categories')
    if (from) q = q.gte('plan_date', from)
    if (to) q = q.lte('plan_date', to)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return NextResponse.json({ overrides: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PUT { plan_date, categories[] } — override zetten (upsert)
export async function PUT(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { plan_date, categories } = await req.json()
    if (!plan_date) return NextResponse.json({ error: 'plan_date vereist' }, { status: 400 })
    const cats = Array.isArray(categories) ? categories.filter((c) => typeof c === 'string') : []
    const admin = createAdminSupabaseClient()
    const { error } = await admin
      .from('month_planning_overrides')
      .upsert({ plan_date, categories: cats, updated_by: actor.id, updated_at: new Date().toISOString() }, { onConflict: 'plan_date' })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?from=&to=  — overrides in periode wissen (reset naar standaard)
export async function DELETE(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const from = req.nextUrl.searchParams.get('from')
    const to = req.nextUrl.searchParams.get('to')
    if (!from || !to) return NextResponse.json({ error: 'from en to vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { error } = await admin
      .from('month_planning_overrides')
      .delete()
      .gte('plan_date', from)
      .lte('plan_date', to)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
