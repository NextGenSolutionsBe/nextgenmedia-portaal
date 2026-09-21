import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { geldigeMetricoolFeedbackUrl, METRICOOL_FEEDBACK_FOUT } from '@/lib/metricool-feedback'

export const dynamic = 'force-dynamic'

// POST — koppel (of ontkoppel) een app-klant aan een Metricool-merk en/of
// bewaar de feedbacklink van de klant. Enkel de meegegeven velden wijzigen:
//   { clientId, blogId | null, brandName | null }   → koppeling
//   { clientId, feedbackUrl: 'https://…' | '' }     → feedbacklink ('' wist)
export async function POST(req: NextRequest) {
  try {
    const actor = await requireAdmin()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const body = (await req.json()) as Record<string, unknown>
    const clientId = typeof body.clientId === 'string' ? body.clientId : null
    if (!clientId) return NextResponse.json({ error: 'clientId vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: client } = await admin.from('clients').select('id, company_name').eq('id', clientId).maybeSingle()
    if (!client) return NextResponse.json({ error: 'Klant niet gevonden' }, { status: 404 })

    const patch: Record<string, unknown> = {}
    const meta = requestMeta(req)
    const audits: Array<Parameters<typeof logAudit>[0]> = []

    if ('blogId' in body) {
      const blogId = body.blogId ? String(body.blogId) : null
      const brandName = body.brandName ? String(body.brandName) : null
      patch.metricool_blog_id = blogId
      patch.metricool_brand_name = blogId ? brandName : null
      audits.push({
        action: 'client.metricool_link', entityType: 'client', entityId: clientId,
        summary: blogId
          ? `Metricool-merk gekoppeld aan ${client.company_name}${brandName ? ` (${brandName})` : ''}`
          : `Metricool-koppeling verwijderd voor ${client.company_name}`,
        actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
        metadata: { blogId }, ip: meta.ip, userAgent: meta.userAgent,
      })
    }

    if ('feedbackUrl' in body) {
      const ruw = String(body.feedbackUrl ?? '').trim()
      let url: string | null = null
      if (ruw) {
        url = geldigeMetricoolFeedbackUrl(ruw)
        if (!url) return NextResponse.json({ error: METRICOOL_FEEDBACK_FOUT }, { status: 400 })
      }
      patch.metricool_feedback_url = url
      audits.push({
        action: 'client.metricool_feedback_url', entityType: 'client', entityId: clientId,
        summary: url ? `Metricool-feedbacklink ingesteld voor ${client.company_name}` : `Metricool-feedbacklink verwijderd voor ${client.company_name}`,
        actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin',
        metadata: { feedbackUrl: url }, ip: meta.ip, userAgent: meta.userAgent,
      })
    }

    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })

    const { error } = await admin.from('clients').update(patch).eq('id', clientId)
    if (error) {
      if ('metricool_feedback_url' in patch && /metricool_feedback_url/.test(error.message)) {
        return NextResponse.json({ error: 'De kolom voor de feedbacklink ontbreekt nog — draai de migratie 99999999_SYNC_ALL.sql.' }, { status: 400 })
      }
      throw new Error(error.message)
    }

    for (const a of audits) await logAudit(a)
    return NextResponse.json({ ok: true, feedbackUrl: 'metricool_feedback_url' in patch ? patch.metricool_feedback_url : undefined })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
