import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission } from '@/lib/portal-auth'
import { metricoolConfigured, listScheduledPosts } from '@/lib/metricool'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

// GET — geplande posts voor de INGELOGDE klant (gekeyd op de geresolveerde
// clientId → eigen metricool_blog_id). Read-only. ?start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const g = await requirePortalPermission('metricool', 'view')
  if (!g.ok) return g.response
  try {
    if (!metricoolConfigured()) return NextResponse.json({ configured: false, posts: [] })

    const admin = createAdminSupabaseClient()
    const { data: client } = await admin
      .from('clients')
      .select('id, company_name, metricool_blog_id')
      .eq('id', g.session.clientId)
      .maybeSingle()

    if (!client?.metricool_blog_id) {
      return NextResponse.json({ configured: true, linked: false, posts: [] })
    }

    const sp = req.nextUrl.searchParams
    const today = new Date()
    const start = sp.get('start') || new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
    const end = sp.get('end') || new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10)

    const list = await listScheduledPosts(client.metricool_blog_id, start, end)
    const posts = list.map((p) => ({ ...p, clientId: client.id, clientName: client.company_name }))
    return NextResponse.json({ configured: true, linked: true, count: posts.length, posts })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
