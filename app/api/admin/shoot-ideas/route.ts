import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff, trySignedUrl } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// GET ?shoot_id= — ideeën van een shoot (met signed urls voor bijlagen)
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const shootId = req.nextUrl.searchParams.get('shoot_id')
    if (!shootId) return NextResponse.json({ error: 'shoot_id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data, error } = await admin.from('shoot_ideas').select('*').eq('shoot_id', shootId).order('created_at', { ascending: false })
    if (error) throw new Error(error.message)
    const ideas = await Promise.all((data ?? []).map(async (i: { attachment_path: string | null }) => ({
      ...i, attachment_url: i.attachment_path ? await trySignedUrl(admin, 'contracts', i.attachment_path) : null,
    })))
    return NextResponse.json({ ideas })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH { idea_id, status?, admin_note? }
export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { idea_id, status, admin_note } = await req.json()
    if (!idea_id) return NextResponse.json({ error: 'idea_id vereist' }, { status: 400 })
    const patch: Record<string, unknown> = {}
    if (status !== undefined && ['new', 'seen', 'use', 'discard'].includes(status)) patch.status = status
    if (admin_note !== undefined) patch.admin_note = admin_note || null
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('shoot_ideas').update(patch).eq('id', idea_id)
    if (error) throw new Error(error.message)
    try { revalidatePath('/portal/social-media') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
