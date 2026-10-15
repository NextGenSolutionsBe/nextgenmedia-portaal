import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { analysisToPromptText, type WebsiteAnalysis } from '@/lib/website-analyze'
import { suggestContentGaps } from '@/lib/blog-ai'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// GET ?id=<account_id>[&gaps=1] — SEO-dashboard per blogaccount.
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const withGaps = req.nextUrl.searchParams.get('gaps') === '1'
    const admin = createAdminSupabaseClient()

    const [{ data: account }, { data: blogs }] = await Promise.all([
      admin.from('blog_accounts').select('id, name, website_analysis, blog_memory').eq('id', id).maybeSingle(),
      admin.from('blogs').select('titel, slug, status, tags').eq('account_id', id),
    ])
    if (!account) return NextResponse.json({ error: 'Blogaccount niet gevonden' }, { status: 404 })

    const rows = (blogs ?? []) as { titel: string; slug: string; status: string; tags: string[] | null }[]
    const total = rows.length
    const published = rows.filter((b) => b.status === 'gepubliceerd')

    // Tag-/keywordfrequentie over alle blogs.
    const freq = new Map<string, number>()
    for (const b of rows) for (const t of b.tags ?? []) { const k = t.trim(); if (k) freq.set(k, (freq.get(k) ?? 0) + 1) }
    const tagFreq = [...freq.entries()].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count)

    const memory = (account.blog_memory ?? {}) as { keywords?: string[] }
    const keywords = (memory.keywords ?? []).slice(0, 60)

    // Interne linksuggesties = de eigen gepubliceerde blogs (onderling linken).
    const internalLinks = published.map((b) => ({ titel: b.titel, slug: b.slug })).slice(0, 50)

    let gaps: string[] = []
    if (withGaps) {
      gaps = await suggestContentGaps({
        clientName: account.name,
        websiteContent: analysisToPromptText((account.website_analysis ?? null) as WebsiteAnalysis | null),
        existingTitles: rows.map((b) => b.titel),
        usedKeywords: [...new Set([...keywords, ...tagFreq.map((t) => t.tag)])],
      })
    }

    return NextResponse.json({
      total, published: published.length,
      keywords,
      mostUsed: tagFreq.slice(0, 8),
      leastUsed: tagFreq.slice(-8).reverse(),
      internalLinks,
      gaps,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
