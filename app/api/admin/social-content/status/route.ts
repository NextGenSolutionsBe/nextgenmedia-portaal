import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { logContentActiviteit } from '@/lib/content/kalender-beheer-server'
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
    const { data: rij, error } = await admin.from('social_content_items').update(patch).eq('id', id).select('id, client_id').maybeSingle()
    if (error) throw new Error(error.message)
    const LABEL: Record<string, string> = { draft: 'Concept', ready_for_review: 'naar de klant gestuurd', approved: 'Goedgekeurd', changes_requested: 'Feedback', scheduled: 'ingepland', published: 'als gepubliceerd gemarkeerd' }
    if (rij) await logContentActiviteit(admin, { item_id: rij.id, client_id: rij.client_id, door: user.email ?? null, rol: 'nextgenmedia', actie: status === 'published' || status === 'scheduled' || status === 'ready_for_review' ? String(LABEL[status]) : `status: ${LABEL[status] ?? status}`, details: { naar: status } })

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
