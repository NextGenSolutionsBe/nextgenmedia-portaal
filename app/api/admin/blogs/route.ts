import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { generateBlogsForAccount, sendBlogReviewMail, BLOG_ACCOUNT_COLS, type BlogAccount } from '@/lib/blog-generate'
import { generateBlog, slugify } from '@/lib/blog-ai'
import { findStockImage, stockImageConfigured } from '@/lib/blog-image'
import { publishApprovedBlog, type AccountFramer, type BlogRow } from '@/lib/blog-publish'
import { snapshotBlogVersion, describeChanges } from '@/lib/blog-versions'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// AI-generatie + website-analyse + Framer-publicatie kunnen tientallen seconden
// duren; verhoog de serverless-tijdslimiet zodat de aanvraag niet afkapt
// ("Failed to fetch"). 60s is het maximum op het Vercel Hobby-plan.
export const maxDuration = 60

const FRAMER_COLS = 'id, framer_project_url, framer_api_key, framer_blog_collection_id, framer_field_map, max_live_blogs'

// GET ?account_id= | ?client_id= | ?status= | ?versions=<blog_id>
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const sp = req.nextUrl.searchParams
    const admin = createAdminSupabaseClient()

    const versionsFor = sp.get('versions')
    if (versionsFor) {
      const { data, error } = await admin.from('blog_versions').select('*').eq('blog_id', versionsFor).order('created_at', { ascending: false }).limit(50)
      if (error) throw new Error(error.message)
      return NextResponse.json({ versions: data ?? [] })
    }

    let q = admin.from('blogs').select('*').order('gegenereerd_op', { ascending: false })
    if (sp.get('account_id')) q = q.eq('account_id', sp.get('account_id'))
    if (sp.get('client_id')) q = q.eq('client_id', sp.get('client_id'))
    if (sp.get('status')) q = q.eq('status', sp.get('status'))
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return NextResponse.json({ blogs: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// POST { action:'generate', account_id, count? } | { action:'bulk', op, ids[] }
export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json()
    const admin = createAdminSupabaseClient()

    if (b.action === 'bulk') return bulk(admin, b, actor.email ?? actor.id)

    // Andere (gratis Pexels-)foto ophalen voor een blog. Geeft enkel een URL terug;
    // opslaan gebeurt apart via de editor.
    if (b.action === 'image') {
      if (!b.id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
      const { data: blog } = await admin.from('blogs').select('titel, tags').eq('id', b.id).maybeSingle()
      if (!blog) return NextResponse.json({ error: 'Blog niet gevonden' }, { status: 404 })
      const query = (b.query?.trim()) || (Array.isArray(blog.tags) && blog.tags.length ? blog.tags.join(' ') : '') || blog.titel
      const url = await findStockImage(query, { random: true })
      if (!url) {
        const msg = stockImageConfigured()
          ? `Geen foto gevonden voor "${query}". Probeer een andere zoekterm.`
          : 'Geen stockfoto-provider geconfigureerd. Stel PEXELS_API_KEY en/of UNSPLASH_ACCESS_KEY in.'
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      return NextResponse.json({ url })
    }

    if (b.action !== 'generate' || !b.account_id) return NextResponse.json({ error: 'Ongeldige actie' }, { status: 400 })
    const { data: account } = await admin.from('blog_accounts').select(BLOG_ACCOUNT_COLS).eq('id', b.account_id).maybeSingle()
    if (!account) return NextResponse.json({ error: 'Blogaccount niet gevonden' }, { status: 404 })
    const count = Math.max(1, Number(b.count) || (account as BlogAccount).aantal_per_cyclus || 1)
    const created = await generateBlogsForAccount(account as BlogAccount, count, { topic: b.topic || null, publishAt: b.publish_at || null })
    await sendBlogReviewMail(account as BlogAccount, created)
    try { revalidatePath('/admin/blogs'); revalidatePath('/admin/blog-calendar') } catch { }
    return NextResponse.json({ created: created.length })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function bulk(admin: any, b: { op?: string; ids?: string[] }, actor: string) {
  const ids = Array.isArray(b.ids) ? b.ids.filter(Boolean) : []
  if (ids.length === 0) return NextResponse.json({ error: 'Geen blogs geselecteerd' }, { status: 400 })

  if (b.op === 'delete') {
    const { error } = await admin.from('blogs').delete().in('id', ids)
    if (error) throw new Error(error.message)
    try { revalidatePath('/admin/blogs') } catch { }
    return NextResponse.json({ ok: true, count: ids.length })
  }

  if (b.op === 'approve' || b.op === 'publish') {
    let published = 0, pending = 0, failed = 0
    for (const id of ids) {
      const { data: blog } = await admin.from('blogs').select('*').eq('id', id).maybeSingle()
      if (!blog || !blog.account_id) continue
      const { data: account } = await admin.from('blog_accounts').select(FRAMER_COLS).eq('id', blog.account_id).maybeSingle()
      if (!account) continue
      const r = await publishApprovedBlog(blog as BlogRow, account as AccountFramer, { confirmOverride: true })
      if (r.published) published++; else if (r.pending) pending++; else failed++
    }
    try { revalidatePath('/admin/blogs') } catch { }
    return NextResponse.json({ ok: true, published, pending, failed })
  }

  if (b.op === 'regenerate') {
    let done = 0
    for (const id of ids) {
      const { data: blog } = await admin.from('blogs').select('*').eq('id', id).maybeSingle()
      if (!blog) continue
      const { data: account } = await admin.from('blog_accounts').select(BLOG_ACCOUNT_COLS).eq('id', blog.account_id).maybeSingle()
      const g = await generateBlog({ clientName: account?.name ?? 'Blog', website: account?.website_url, brandContext: account?.briefing, recentTitles: [blog.titel] })
      await admin.from('blogs').update({ titel: g.titel, content: g.content, meta_title: g.meta_title, meta_description: g.meta_description, status: 'klaar_voor_review', sync_status: null, foutmelding: null }).eq('id', id)
      done++
    }
    try { revalidatePath('/admin/blogs') } catch { }
    return NextResponse.json({ ok: true, count: done })
  }

  return NextResponse.json({ error: 'Onbekende bulkactie' }, { status: 400 })
}

// PATCH { id, action?, ...fields }
export async function PATCH(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 400 })
    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: blog } = await admin.from('blogs').select('*').eq('id', b.id).maybeSingle()
    if (!blog) return NextResponse.json({ error: 'Blog niet gevonden' }, { status: 404 })

    if (b.action === 'restore_version') {
      const { data: version } = await admin.from('blog_versions').select('*').eq('id', b.version_id).eq('blog_id', b.id).maybeSingle()
      if (!version) return NextResponse.json({ error: 'Versie niet gevonden' }, { status: 404 })
      // Huidige toestand eerst bewaren, dan terugzetten.
      await snapshotBlogVersion(admin, blog.id, blog, actor.email ?? actor.id, 'voor herstel naar vorige versie')
      const patch: Record<string, unknown> = {
        titel: version.titel, slug: version.slug, content: version.content,
        meta_title: version.meta_title, meta_description: version.meta_description, thumbnail_url: version.thumbnail_url,
        laatst_bewerkt_door: actor.email ?? actor.id, laatst_bewerkt_op: new Date().toISOString(),
      }
      if (blog.status === 'gepubliceerd') patch.sync_status = 'pending'
      const { error } = await admin.from('blogs').update(patch).eq('id', b.id)
      if (error) throw new Error(error.message)
      try { revalidatePath('/admin/blogs') } catch { }
      return NextResponse.json({ ok: true })
    }

    if (b.action === 'regenerate') {
      const { data: account } = await admin.from('blog_accounts').select(BLOG_ACCOUNT_COLS).eq('id', blog.account_id).maybeSingle()
      const g = await generateBlog({ clientName: account?.name ?? 'Blog', website: account?.website_url, brandContext: account?.briefing, recentTitles: [blog.titel] })
      const { error } = await admin.from('blogs').update({ titel: g.titel, content: g.content, meta_title: g.meta_title, meta_description: g.meta_description, status: 'klaar_voor_review', sync_status: null, foutmelding: null }).eq('id', b.id)
      if (error) throw new Error(error.message)
      try { revalidatePath('/admin/blogs') } catch { }
      return NextResponse.json({ ok: true })
    }

    if (b.action === 'approve') {
      const { data: account } = await admin.from('blog_accounts').select(FRAMER_COLS).eq('id', blog.account_id).maybeSingle()
      const mode = b.publish_mode || blog.publish_mode || 'now'
      const when = b.publish_at || blog.publish_at || null

      // "Concept houden": niet publiceren, terug als concept/review klaarzetten.
      if (mode === 'concept') {
        const { error } = await admin.from('blogs').update({ status: 'klaar_voor_review', publish_mode: 'now', publish_at: null, sync_status: null, foutmelding: null }).eq('id', b.id)
        if (error) throw new Error(error.message)
        try { revalidatePath('/admin/blogs'); revalidatePath('/admin/blog-calendar') } catch { }
        return NextResponse.json({ ok: true, concept: true })
      }

      // "Publiceer later": plannen i.p.v. nu publiceren.
      if (mode === 'scheduled' && when) {
        const { error } = await admin.from('blogs').update({ status: 'goedgekeurd', goedgekeurd_op: blog.goedgekeurd_op ?? new Date().toISOString(), publish_mode: 'scheduled', publish_at: when, sync_status: 'pending', foutmelding: null }).eq('id', b.id)
        if (error) throw new Error(error.message)
        try { revalidatePath('/admin/blogs'); revalidatePath('/admin/blog-calendar') } catch { }
        return NextResponse.json({ ok: true, scheduled: true })
      }

      if (b.publish_mode) await admin.from('blogs').update({ publish_mode: b.publish_mode }).eq('id', b.id)
      const r = await publishApprovedBlog(blog as BlogRow, (account ?? { id: blog.account_id }) as AccountFramer, { confirmOverride: !!b.confirm_override })
      if (r.needsConfirm) return NextResponse.json({ ok: true, needsConfirm: true, warning: r.warning ?? null })
      try { revalidatePath('/admin/blogs') } catch { }
      return NextResponse.json({ ok: true, published: r.published, pending: r.pending, firstPublish: r.firstPublish, maxLiveTrimmed: r.maxLiveTrimmed, error: r.error })
    }

    // Velden bewerken — eerst de huidige versie bewaren (versiegeschiedenis).
    const patch: Record<string, unknown> = {}
    if (b.titel !== undefined) patch.titel = String(b.titel)
    if (b.slug !== undefined) patch.slug = slugify(String(b.slug))
    if (b.content !== undefined) patch.content = b.content
    if (b.meta_title !== undefined) patch.meta_title = b.meta_title
    if (b.meta_description !== undefined) patch.meta_description = b.meta_description
    if (b.thumbnail_url !== undefined) patch.thumbnail_url = b.thumbnail_url || null
    if (b.publish_mode !== undefined) patch.publish_mode = b.publish_mode
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })

    await snapshotBlogVersion(admin, blog.id, blog, actor.email ?? actor.id, describeChanges(blog, patch))
    patch.laatst_bewerkt_door = actor.email ?? actor.id
    patch.laatst_bewerkt_op = new Date().toISOString()
    // Bewerking van een reeds gepubliceerde blog → nog niet gesynchroniseerd.
    if (blog.status === 'gepubliceerd' && ('content' in patch || 'titel' in patch || 'meta_title' in patch || 'meta_description' in patch || 'thumbnail_url' in patch)) patch.sync_status = 'pending'

    const { error } = await admin.from('blogs').update(patch).eq('id', b.id)
    if (error) throw new Error(error.message)
    try { revalidatePath('/admin/blogs') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('blogs').delete().eq('id', id)
    if (error) throw new Error(error.message)
    try { revalidatePath('/admin/blogs') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
