import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/supabase/server'
import { metricoolConfigured, listBrands, diagnoseScheduledPosts } from '@/lib/metricool'
import { diagnoseInbox } from '@/lib/metricool-inbox'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET — diagnose (admin-only). Zonder login: /api/cron/community-diag met het cron-geheim.
// Bevestigt welke endpoints werken en toont de ruwe respons, zodat we de exacte
// veldnamen kunnen mappen zonder gokwerk. Leest enkel; wijzigt niets in Metricool.
//   ?blogId=123&start=YYYY-MM-DD&end=YYYY-MM-DD      geplande posts
//   ?inbox=1&blogId=123&netwerk=instagram             inbox (comments, gesprekken + authorizations)
//   ?brands=1                                          enkel de lijst van merken
export async function GET(req: NextRequest) {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    if (!metricoolConfigured()) {
      return NextResponse.json({ configured: false, hint: 'Zet METRICOOL_USER_TOKEN + METRICOOL_USER_ID in de omgeving.' })
    }
    const sp = req.nextUrl.searchParams

    if (sp.get('brands') === '1') {
      const brands = await listBrands()
      return NextResponse.json({ configured: true, brands })
    }

    if (sp.get('inbox') === '1') {
      const blogId = sp.get('blogId')
      const netwerk = (sp.get('netwerk') ?? 'instagram').toLowerCase()
      if (!blogId) return NextResponse.json({ error: 'blogId is verplicht (zie ?brands=1).' }, { status: 400 })
      return NextResponse.json({ configured: true, blogId, netwerk, inbox: await diagnoseInbox(blogId, netwerk) })
    }

    const today = new Date()
    const start = sp.get('start') || today.toISOString().slice(0, 10)
    const end = sp.get('end') || new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().slice(0, 10)

    const brands = await listBrands()
    const blogId = sp.get('blogId') || brands[0]?.blogId
    const scheduled = blogId ? await diagnoseScheduledPosts(blogId, start, end) : []

    return NextResponse.json({
      configured: true,
      brandsFound: brands.length,
      brandsSample: brands.slice(0, 5),
      testedBlogId: blogId ?? null,
      scheduledAttempts: scheduled,
    })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Fout' }, { status: 400 })
  }
}
