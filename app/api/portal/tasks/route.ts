import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { requirePortalPermission, sessionCan, logPortalAction } from '@/lib/portal-auth'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// PATCH { id, action: 'complete' | 'note', note? } — klant werkt eigen taak bij.
// Klant kan taken NIET verwijderen; enkel voltooien of een opmerking toevoegen.
export async function PATCH(req: NextRequest) {
  try {
    const g = await requirePortalPermission('tasks', 'view')
    if (!g.ok) return g.response
    const { session } = g

    const { id, action, note } = await req.json()
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })

    // Voltooien vereist expliciet tasks.complete.
    if (action === 'complete' && !sessionCan(session, 'tasks', 'complete')) {
      return NextResponse.json({ error: 'Geen toestemming om taken te voltooien' }, { status: 403 })
    }

    const admin = createAdminSupabaseClient()
    const { data: task } = await admin.from('client_tasks').select('id, client_id').eq('id', id).maybeSingle()
    if (!task || task.client_id !== session.clientId) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const patch: Record<string, unknown> = {}
    if (action === 'complete') { patch.status = 'done'; patch.completed_at = new Date().toISOString() }
    if (note !== undefined) patch.client_note = note || null
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Geen wijziging' }, { status: 400 })

    const { error } = await admin.from('client_tasks').update(patch).eq('id', id)
    if (error) throw new Error(error.message)

    if (action === 'complete') {
      await logPortalAction(session, 'portal.task.completed', { type: 'client_task', id }, { req })
    }

    try { revalidatePath('/portal/tasks'); revalidatePath('/admin') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
