import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (data?.role !== 'admin' && !(await isActiveStaff(user.id))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const admin = createAdminSupabaseClient()
    const { id, status } = await req.json()
    const patch: Record<string, unknown> = { status }
    if (status === 'published') patch.published_at = new Date().toISOString()
    const { error } = await admin.from('social_content_items').update(patch).eq('id', id)
    if (error) throw new Error(error.message)

    try {
      revalidatePath('/admin/services/social-media')
      revalidatePath('/portal/social-media')
      revalidatePath('/portal')
    } catch { }

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
