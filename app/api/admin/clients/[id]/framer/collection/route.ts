import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// POST — of de klant een collectie mag bewerken. body: { framerCollectionId, clientEditable }
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const { framerCollectionId, clientEditable } = await req.json()
    if (!framerCollectionId) return NextResponse.json({ error: 'framerCollectionId vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { error } = await admin
      .from('cms_collections')
      .update({ client_editable: !!clientEditable })
      .eq('client_id', id)
      .eq('framer_collection_id', String(framerCollectionId))
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
