import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// GET ?shoot_id= — feedback van een shoot
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const shootId = req.nextUrl.searchParams.get('shoot_id')
    if (!shootId) return NextResponse.json({ error: 'shoot_id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin
      .from('shoot_briefing_feedback')
      .select('*')
      .eq('shoot_id', shootId)
      .order('created_at', { ascending: true })
    if (error) throw new Error(error.message)
    return NextResponse.json({ feedback: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH { feedback_id, resolved } — markeer feedback als verwerkt / onverwerkt
export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { feedback_id, resolved } = await req.json()
    if (!feedback_id) return NextResponse.json({ error: 'feedback_id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { error } = await admin
      .from('shoot_briefing_feedback')
      .update({ resolved: Boolean(resolved) })
      .eq('id', feedback_id)
    if (error) throw new Error(error.message)
    try { revalidatePath('/portal/social-media') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
