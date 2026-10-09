import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { metricoolConfigured, listScheduledPosts, type MetricoolPost } from '@/lib/metricool'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export type MetricoolPostWithClient = MetricoolPost & { clientId: string; clientName: string }

// GET — geaggregeerde geplande posts over de gekoppelde klanten binnen een bereik.
//   ?start=YYYY-MM-DD&end=YYYY-MM-DD&clientIds=a,b,c   (clientIds optioneel = alle gekoppelde)
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!metricoolConfigured()) return NextResponse.json({ configured: false, posts: [] })

    const sp = req.nextUrl.searchParams
    const today = new Date()
    const start = sp.get('start') || new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
    const end = sp.get('end') || new Date(today.getFullYear(), today.getMonth() + 2, 0).toISOString().slice(0, 10)
    const filter = (sp.get('clientIds') || '').split(',').map((s) => s.trim()).filter(Boolean)

    const admin = createAdminSupabaseClient()
    let q = admin.from('clients')
      .select('id, company_name, metricool_blog_id')
      .not('metricool_blog_id', 'is', null)
    if (filter.length > 0) q = q.in('id', filter)
    const { data: clients } = await q

    const linked = (clients ?? []).filter((c) => c.metricool_blog_id)
    const errors: Array<{ clientId: string; clientName: string; error: string }> = []
    const posts: MetricoolPostWithClient[] = []

    // Sequentieel (throttling zit in de lib) — per klant veilig falen.
    for (const c of linked) {
      try {
        const list = await listScheduledPosts(c.metricool_blog_id as string, start, end)
        for (const p of list) posts.push({ ...p, clientId: c.id, clientName: c.company_name })
      } catch (e) {
        errors.push({ clientId: c.id, clientName: c.company_name, error: e instanceof Error ? e.message : 'Fout' })
      }
    }

    posts.sort((a, b) => (a.datetime ?? '').localeCompare(b.datetime ?? ''))
    return NextResponse.json({ configured: true, start, end, count: posts.length, posts, errors })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
