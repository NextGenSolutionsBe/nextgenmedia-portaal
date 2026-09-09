import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

// POST — koppel (of ontkoppel) een app-klant aan een Metricool-merk.
// body: { clientId, blogId | null, brandName | null }
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { clientId, blogId, brandName } = await req.json()
    if (!clientId) return NextResponse.json({ error: 'clientId vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: client } = await admin.from('clients').select('id, company_name').eq('id', clientId).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })

    const { error } = await admin.from('clients').update({
      metricool_blog_id: blogId ? String(blogId) : null,
      metricool_brand_name: blogId ? (brandName ? String(brandName) : null) : null,
    }).eq('id', clientId)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'client.metricool_link',
      entityType: 'client', entityId: clientId,
      summary: blogId
        ? `Metricool-merk gekoppeld aan ${client.company_name}${brandName ? ` (${brandName})` : ''}`
        : `Metricool-koppeling verwijderd voor ${client.company_name}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
      metadata: { blogId: blogId ?? null }, ip: meta.ip, userAgent: meta.userAgent,
    })

    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
