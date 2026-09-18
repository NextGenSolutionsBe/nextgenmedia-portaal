import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { sendEmail, getAdminEmails, baseUrl } from '@/lib/email'
import { buildEmailHtml, buildEmailText } from '@/lib/email-html'
import { generateBlog, slugify, type BlogMemory, type BlogKnowledge } from '@/lib/blog-ai'
import { nextGenerationDate, todayISO } from '@/lib/blog-dates'
import { analyzeWebsiteDeep, analysisToPromptText, type WebsiteAnalysis } from '@/lib/website-analyze'
import { findStockImage } from '@/lib/blog-image'

export type BlogAccount = {
  id: string; name: string; website_url: string | null; briefing: string | null
  aantal_per_cyclus: number | null; frequentie_maanden: number | null
  volgende_generatie_datum: string | null; client_id: string | null
  website_analysis?: WebsiteAnalysis | null; website_analyzed_at?: string | null
  blog_memory?: BlogMemory | null; knowledge?: BlogKnowledge | null
}

export const BLOG_ACCOUNT_COLS = 'id, name, website_url, briefing, aantal_per_cyclus, frequentie_maanden, volgende_generatie_datum, client_id, website_analysis, website_analyzed_at, blog_memory, knowledge'

const emptyMemory = (): BlogMemory => ({ topics: [], keywords: [], angles: [], ctas: [] })

/** Voegt nieuwe items toe aan een geheugenlijst zonder duplicaten, met een plafond. */
function mergeMemoryList(existing: string[] | undefined, add: string[], cap = 200): string[] {
  const seen = new Set((existing ?? []).map((x) => x.toLowerCase()))
  const out = [...(existing ?? [])]
  for (const a of add) { const k = a.trim(); if (k && !seen.has(k.toLowerCase())) { seen.add(k.toLowerCase()); out.push(k) } }
  return out.slice(-cap)
}

/**
 * Haalt de gecachte website-analyse op of voert die éénmalig uit en bewaart ze.
 * Wordt NIET elke generatie opnieuw uitgevoerd (caching).
 */
export async function getOrAnalyzeWebsite(account: BlogAccount): Promise<WebsiteAnalysis | null> {
  if (account.website_analysis && account.website_analyzed_at) return account.website_analysis
  if (!account.website_url) return null
  const analysis = await analyzeWebsiteDeep(account.website_url)
  if (analysis) {
    try { await createAdminSupabaseClient().from('blog_accounts').update({ website_analysis: analysis, website_analyzed_at: new Date().toISOString() }).eq('id', account.id) } catch { }
  }
  return analysis
}

/** Genereert `count` blogs voor een blogaccount; opslaan als klaar_voor_review. */
export async function generateBlogsForAccount(account: BlogAccount, count: number, opts?: { topic?: string | null; publishAt?: string | null }): Promise<{ id: string; titel: string }[]> {
  const admin = createAdminSupabaseClient()

  const { data: recent } = await admin.from('blogs').select('titel, slug').eq('account_id', account.id).order('gegenereerd_op', { ascending: false }).limit(50)
  const recentTitles = (recent ?? []).map((b: { titel: string }) => b.titel).filter(Boolean)
  const usedSlugs = new Set((recent ?? []).map((b: { slug: string }) => b.slug))

  const analysis = await getOrAnalyzeWebsite(account)
  const websiteContent = analysisToPromptText(analysis)
  const memory: BlogMemory = { ...emptyMemory(), ...(account.blog_memory ?? {}) }
  const publishAt = opts?.publishAt || null

  const created: { id: string; titel: string }[] = []
  for (let i = 0; i < Math.max(1, count); i++) {
    const blog = await generateBlog({
      clientName: account.name, website: account.website_url, brandContext: account.briefing,
      websiteContent, recentTitles: [...recentTitles, ...created.map((c) => c.titel)], memory,
      knowledge: account.knowledge ?? null, topic: opts?.topic ?? null,
    })
    let slug = blog.slug || slugify(blog.titel)
    let n = 2
    while (usedSlugs.has(slug)) { slug = `${blog.slug}-${n++}` }
    usedSlugs.add(slug)

    // Gratis passende stockfoto (Pexels) op basis van de AI-zoekterm; best-effort.
    const imageQuery = blog.image_query || blog.keywords.slice(0, 3).join(' ') || blog.topic || account.name
    const thumbnail = blog.thumbnail_url || (await findStockImage(imageQuery))

    const { data, error } = await admin.from('blogs').insert({
      account_id: account.id, client_id: account.client_id ?? null,
      titel: blog.titel, slug, content: blog.content, meta_title: blog.meta_title,
      meta_description: blog.meta_description, thumbnail_url: thumbnail, status: 'klaar_voor_review',
      tags: blog.tags?.length ? blog.tags : null,
      // Optionele gewenste publicatiedatum meteen meegeven; effectieve planning
      // gebeurt pas bij goedkeuren in de kalender.
      publish_mode: publishAt ? 'scheduled' : 'now', publish_at: publishAt,
    }).select('id, titel').single()
    if (!error && data) {
      created.push(data)
      // Geheugen in-memory bijwerken zodat de volgende blog in deze batch ook varieert.
      memory.topics = mergeMemoryList(memory.topics, [blog.topic])
      memory.keywords = mergeMemoryList(memory.keywords, blog.keywords)
      memory.angles = mergeMemoryList(memory.angles, [blog.angle])
      memory.ctas = mergeMemoryList(memory.ctas, [blog.cta])
    }
  }

  // Bijgewerkt blog-geheugen persisteren (herhaling vermijden bij volgende cyclus).
  if (created.length > 0) {
    try { await admin.from('blog_accounts').update({ blog_memory: memory }).eq('id', account.id) } catch { }
  }
  return created
}

/** Adminmail "Nieuwe blogs klaar voor review — {account}". Nooit naar klant. */
export async function sendBlogReviewMail(account: BlogAccount, blogs: { id: string; titel: string }[]): Promise<void> {
  if (blogs.length === 0) return
  try {
    const link = `${baseUrl()}/admin/blogs?account=${account.id}`
    const subject = `Nieuwe blogs klaar voor review — ${account.name}`
    const body = `Er staan ${blogs.length} nieuwe blog(s) klaar voor review voor ${account.name}.\n\n${blogs.map((b) => `• ${b.titel}`).join('\n')}`
    const html = buildEmailHtml({ bodyText: body, ctaText: 'Naar review', ctaLink: link })
    const text = buildEmailText({ bodyText: body, ctaText: 'Naar review', ctaLink: link })
    const recipients = await getAdminEmails()
    const res = await sendEmail({ to: recipients, subject, text, html })
    const admin = createAdminSupabaseClient()
    await admin.from('email_messages').insert({
      to_email: recipients.join(', '), to_client_id: account.client_id, subject, body, kind: 'blog_review', audience: 'admin',
      trigger_type: 'event', item_count: blogs.length, related_id: account.id,
      status: res.ok ? 'sent' : 'error', error: res.ok ? null : res.error, provider_id: res.id || null,
    })
  } catch { /* mail mag de generatie nooit breken */ }
}

/** Dagelijkse scheduler over blogaccounts. */
export async function runBlogScheduler(now = new Date()): Promise<{ accounts: number; blogs: number; failed: number }> {
  const admin = createAdminSupabaseClient()
  const today = todayISO(now)
  const { data: due } = await admin.from('blog_accounts')
    .select(BLOG_ACCOUNT_COLS)
    .eq('active', true)
    .not('volgende_generatie_datum', 'is', null)
    .lte('volgende_generatie_datum', today)

  let totalBlogs = 0
  let accountCount = 0
  let failed = 0
  for (const a of (due ?? []) as BlogAccount[]) {
    const count = Math.max(1, a.aantal_per_cyclus ?? 1)
    try {
      const created = await generateBlogsForAccount(a, count)
      if (created.length > 0) { totalBlogs += created.length; accountCount++; await sendBlogReviewMail(a, created) }
      // Volgende generatiedatum enkel opschuiven bij succes, zodat een mislukte
      // account de volgende dag opnieuw geprobeerd wordt (en niet stilletjes overslaat).
      const base = a.volgende_generatie_datum ?? today
      const next = nextGenerationDate(base, a.frequentie_maanden ?? 1)
      await admin.from('blog_accounts').update({ volgende_generatie_datum: next }).eq('id', a.id)
    } catch {
      // Eén falende account mag de hele cron niet stoppen; volgende datum NIET
      // opschuiven zodat er morgen opnieuw geprobeerd wordt.
      failed++
    }
  }
  return { accounts: accountCount, blogs: totalBlogs, failed }
}
