import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

const ALLOWED_STATUSES = ['new', 'in_progress', 'rejected', 'done', 'archived']
const STORAGE_BUCKET = 'contracts'

function invalidateWebdesignCaches() {
  try {
    revalidatePath('/admin/services/website')
    revalidatePath('/portal/website')
  } catch { }
}

export async function PATCH(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { id, status, admin_notes } = await req.json()
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    if (status && !ALLOWED_STATUSES.includes(status)) {
      return NextResponse.json({ error: `Ongeldige status: ${status}` }, { status: 400 })
    }

    const patch: Record<string, unknown> = {}
    if (status !== undefined) patch.status = status
    if (admin_notes !== undefined) patch.admin_notes = admin_notes
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })
    }

    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('webdesign_change_requests').update(patch).eq('id', id)
    if (error) throw new Error(error.message)

    invalidateWebdesignCaches()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — permanently remove a request and its uploaded images.
// Combines delete + image_paths retrieval into a single round-trip via `.delete().select()`.
export async function DELETE(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()

    // Single round-trip: delete row AND return its image_paths so we can clean storage.
    // select('*') so this still works when the image_paths column doesn't exist yet.
    const { data: deleted, error } = await admin
      .from('webdesign_change_requests')
      .delete()
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (error) throw new Error(error.message)

    const paths: string[] = Array.isArray(deleted?.image_paths) ? deleted.image_paths : []
    if (paths.length > 0) {
      try { await admin.storage.from(STORAGE_BUCKET).remove(paths) } catch { }
    }

    invalidateWebdesignCaches()
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
