import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requirePortalPermission } from '@/lib/portal-auth'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// POST — klant plaatst feedback op een shoot-briefing van zijn eigen klant.
export async function POST(req: NextRequest) {
  try {
    const g = await requirePortalPermission('social_media', 'feedback')
    if (!g.ok) return g.response
    const { session } = g

    const { shoot_id, message } = await req.json()
    if (!shoot_id || !message?.trim()) {
      return NextResponse.json({ error: 'Bericht is verplicht' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()

    // Eigendomscheck: hoort de shoot bij deze klant?
    const { data: shoot } = await admin
      .from('shoot_briefings').select('id, client_id').eq('id', shoot_id).maybeSingle()
    if (!shoot || shoot.client_id !== session.clientId) {
      return NextResponse.json({ error: 'Geen toegang tot deze shoot' }, { status: 403 })
    }

    const { error } = await admin.from('shoot_briefing_feedback').insert({
      shoot_id,
      client_id: session.clientId,
      author_role: 'client',
      message: String(message).trim(),
    })
    if (error) throw new Error(error.message)

    try { revalidatePath('/portal/social-media') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
