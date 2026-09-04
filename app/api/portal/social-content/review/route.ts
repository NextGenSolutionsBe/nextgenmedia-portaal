import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { notifyClientScriptActivity } from '@/lib/admin-alerts'
import { requirePortalPermission, sessionCan, logPortalAction } from '@/lib/portal-auth'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const g = await requirePortalPermission('social_media', 'view')
    if (!g.ok) return g.response
    const { session } = g

    const { id, decision, feedback } = await req.json()

    // Goedkeuren vereist approve_scripts; wijziging vragen vereist feedback-recht.
    if (decision === 'approved' && !sessionCan(session, 'social_media', 'approve_scripts')) {
      return NextResponse.json({ error: 'Geen toestemming om scripts goed te keuren' }, { status: 403 })
    }
    if (decision === 'changes_requested') {
      if (!sessionCan(session, 'social_media', 'feedback')) {
        return NextResponse.json({ error: 'Geen toestemming om feedback te geven' }, { status: 403 })
      }
      if (!feedback?.trim()) return NextResponse.json({ error: 'Feedback is verplicht bij wijzigingsverzoek' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()
    const { error } = await admin
      .from('social_content_items')
      .update({
        status: decision,
        client_feedback: feedback || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('client_id', session.clientId)

    if (error) throw new Error(error.message)

    try {
      revalidatePath('/portal')
      revalidatePath('/portal/social-media')
      revalidatePath('/admin/services/social-media')
    } catch { }

    await logPortalAction(
      session,
      decision === 'approved' ? 'portal.script.approved' : 'portal.script.changes_requested',
      { type: 'social_content_item', id },
      { req, meta: { decision } },
    )

    // Directe interne adminmail met 1-uur bundeling per klant (best-effort).
    await notifyClientScriptActivity(session.clientId)

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
