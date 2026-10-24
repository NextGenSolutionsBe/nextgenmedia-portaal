import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { importFramerCms } from '@/lib/cms-import'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST — haal de volledige website-CMS op en spiegel die in de app.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params

    const admin = createAdminSupabaseClient()
    const { data: client } = await admin.from('clients').select('company_name').eq('id', id).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })

    const summary = await importFramerCms(id)

    const meta = requestMeta(req)
    await logAudit({
      action: 'client.framer.analyze', entityType: 'client', entityId: id,
      summary: `Website-CMS opgehaald voor ${client.company_name}: ${summary.collections} collectie(s), ${summary.items} item(s)`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      metadata: { ...summary }, ip: meta.ip, userAgent: meta.userAgent,
    })

    return NextResponse.json({ ok: true, summary })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
