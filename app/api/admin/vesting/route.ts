import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { attributionFor } from '@/lib/vesting'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

// POST — nieuwe vestigingsomzet-registratie
export async function POST(req: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const body = await req.json()
    const { client_name, service_slug, entry_date, net_revenue, type, outreach, closing } = body
    if (!net_revenue || Number(net_revenue) <= 0) return NextResponse.json({ error: 'Netto omzet is verplicht' }, { status: 400 })
    const t = type === 'outbound' ? 'outbound' : 'inbound'
    const oReach = t === 'outbound' ? Boolean(outreach) : false
    const isClosing = Boolean(closing)

    const admin = createAdminSupabaseClient()
    const net = Number(net_revenue)
    const attribution = attributionFor(t, { outreach: oReach, closing: isClosing })
    const vesting = Math.round((net * attribution) / 100 * 100) / 100

    const { error } = await admin.from('vesting_revenue').insert({
      client_name: client_name?.trim() || null,
      service_slug: service_slug || null,
      entry_date: entry_date || new Date().toISOString().slice(0, 10),
      net_revenue: net,
      type: t,
      outreach: t === 'outbound' ? oReach : null,
      closing: isClosing,
      attribution_pct: attribution,
      vesting_revenue: vesting,
    })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, vesting })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — config bijwerken (één rij, id=1)
export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const body = await req.json()
    const row: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() }
    for (const k of ['schijf2_per', 'schijf3_y1', 'schijf3_y2', 'schijf3_y3', 'inbound_pct', 'website_pct'] as const) {
      if (body[k] !== undefined && body[k] !== '') row[k] = Number(body[k])
    }
    if (body.start_date !== undefined) row.start_date = body.start_date || null
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('vesting_config').upsert(row, { onConflict: 'id' })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?id= — registratie verwijderen
export async function DELETE(req: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('vesting_revenue').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
