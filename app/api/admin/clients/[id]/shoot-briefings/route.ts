import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

const FIELDS = ['shoot_date', 'start_time', 'end_time', 'location', 'briefing'] as const

function cleanPayload(body: Record<string, unknown>) {
  const out: Record<string, unknown> = {}
  for (const k of FIELDS) {
    if (body[k] !== undefined) out[k] = body[k] === '' ? null : body[k]
  }
  return out
}

// GET — alle shoots van een klant
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin
      .from('shoot_briefings')
      .select('*')
      .eq('client_id', id)
      .order('shoot_date', { ascending: false, nullsFirst: false })
    if (error) throw new Error(error.message)
    return NextResponse.json({ shoots: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST — nieuwe shoot
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const body = await req.json()

    const { data, error } = await admin
      .from('shoot_briefings')
      .insert({ client_id: id, ...cleanPayload(body) })
      .select('id')
      .single()
    if (error) throw new Error(error.message)

    try { revalidatePath('/portal/social-media') } catch { }
    return NextResponse.json({ id: data.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — shoot bewerken
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const body = await req.json()
    const { shoot_id } = body
    if (!shoot_id) return NextResponse.json({ error: 'shoot_id vereist' }, { status: 400 })

    const patch = cleanPayload(body)
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })

    const { error } = await admin
      .from('shoot_briefings')
      .update(patch)
      .eq('id', shoot_id)
      .eq('client_id', id)
    if (error) throw new Error(error.message)

    try { revalidatePath('/portal/social-media') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — shoot verwijderen (?shoot_id=)
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const shootId = req.nextUrl.searchParams.get('shoot_id')
    if (!shootId) return NextResponse.json({ error: 'shoot_id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()

    const { error } = await admin
      .from('shoot_briefings')
      .delete()
      .eq('id', shootId)
      .eq('client_id', id)
    if (error) throw new Error(error.message)

    try { revalidatePath('/portal/social-media') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
