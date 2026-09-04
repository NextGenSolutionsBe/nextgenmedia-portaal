import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { publishBlogToFramer, markFramerSync, type FramerClientConfig } from '@/lib/framer'

// Gedeelde publicatielogica: gebruikt door de admin-approve (handmatig) én door
// de scheduler (geplande/automatische publicatie). Zorgt voor één consistente
// flow incl. synchronisatiestatus en het afdwingen van het maximum live blogs.

export type AccountFramer = {
  id: string
  framer_project_url: string | null
  framer_api_key: string | null
  framer_blog_collection_id: string | null
  framer_field_map: unknown
  max_live_blogs: number | null
}

export type BlogRow = {
  id: string; account_id: string | null; titel: string; slug: string; content: string | null
  meta_title: string | null; meta_description: string | null; thumbnail_url: string | null
  framer_item_id: string | null; goedgekeurd_op: string | null; status: string
}

export type PublishOutcome = {
  ok: boolean
  published: boolean
  pending: boolean
  needsConfirm?: boolean
  warning?: string | null
  error?: string | null
  firstPublish?: boolean
  maxLiveTrimmed?: number
}

/**
 * Publiceert een goedgekeurde blog naar Framer en houdt status + sync_status bij.
 * - sync_status: synced (ok) | failed (echte fout) | pending (nog niet geactiveerd)
 * - dwingt het maximum aantal live blogs af (oudste terug op draft)
 */
export async function publishApprovedBlog(blog: BlogRow, account: AccountFramer, opts?: { confirmOverride?: boolean }): Promise<PublishOutcome> {
  const admin = createAdminSupabaseClient()
  const config: FramerClientConfig = {
    projectUrl: account.framer_project_url ?? null, apiKeyEncrypted: account.framer_api_key ?? null,
    collectionId: account.framer_blog_collection_id ?? null, fieldMap: (account.framer_field_map ?? null) as Record<string, string> | null,
  }

  const { count: prevPublished } = await admin.from('blogs').select('id', { count: 'exact', head: true }).eq('account_id', blog.account_id).eq('status', 'gepubliceerd')
  const firstPublish = (prevPublished ?? 0) === 0

  const result = await publishBlogToFramer(config, {
    id: blog.id, titel: blog.titel, slug: blog.slug, content: blog.content,
    meta_title: blog.meta_title, meta_description: blog.meta_description, thumbnail_url: blog.thumbnail_url, framer_item_id: blog.framer_item_id,
  }, { confirmOverride: !!opts?.confirmOverride, accountId: account.id })

  if (result.needsConfirm) return { ok: true, published: false, pending: false, needsConfirm: true, warning: result.warning ?? null }

  const nowIso = new Date().toISOString()
  const patch: Record<string, unknown> = { status: 'goedgekeurd', goedgekeurd_op: blog.goedgekeurd_op ?? nowIso }
  if (result.ok) { patch.status = 'gepubliceerd'; patch.gepubliceerd_op = nowIso; patch.foutmelding = null; patch.sync_status = 'synced'; if (result.framerItemId) patch.framer_item_id = result.framerItemId }
  else if (result.pending) { patch.foutmelding = result.error ?? null; patch.sync_status = 'pending' }
  else { patch.status = 'gefaald'; patch.foutmelding = result.error ?? 'Publicatie mislukt'; patch.sync_status = 'failed' }
  await admin.from('blogs').update(patch).eq('id', blog.id)

  let maxLiveTrimmed = 0
  if (result.ok) {
    await markFramerSync(account.id)
    const max = Number(account.max_live_blogs) || 0
    if (max > 0) {
      const { data: live } = await admin.from('blogs').select('id, gepubliceerd_op').eq('account_id', blog.account_id).eq('status', 'gepubliceerd').order('gepubliceerd_op', { ascending: true })
      const over = (live ?? []).slice(0, Math.max(0, (live ?? []).length - max))
      if (over.length > 0) {
        await admin.from('blogs').update({ status: 'goedgekeurd', sync_status: 'pending', foutmelding: 'Op draft gezet — maximum live blogs bereikt.' }).in('id', over.map((o: { id: string }) => o.id))
        maxLiveTrimmed = over.length
      }
    }
  }

  return { ok: true, published: !!result.ok, pending: !!result.pending, error: result.ok ? null : result.error, firstPublish, maxLiveTrimmed }
}

const FRAMER_COLS = 'id, framer_project_url, framer_api_key, framer_blog_collection_id, framer_field_map, max_live_blogs'
const BLOG_COLS = 'id, account_id, titel, slug, content, meta_title, meta_description, thumbnail_url, framer_item_id, goedgekeurd_op, status'

/** Publiceert alle blogs die gepland staan (publish_mode='scheduled', publish_at<=nu). */
export async function publishScheduledBlogs(now = new Date()): Promise<{ published: number; failed: number }> {
  const admin = createAdminSupabaseClient()
  const { data: due } = await admin.from('blogs')
    .select(BLOG_COLS + ', publish_at')
    .eq('status', 'goedgekeurd')
    .eq('publish_mode', 'scheduled')
    .not('publish_at', 'is', null)
    .lte('publish_at', now.toISOString())
  let published = 0, failed = 0
  for (const blog of (due ?? []) as unknown as BlogRow[]) {
    if (!blog.account_id) continue
    const { data: account } = await admin.from('blog_accounts').select(FRAMER_COLS).eq('id', blog.account_id).maybeSingle()
    if (!account) continue
    const r = await publishApprovedBlog(blog, account as AccountFramer, { confirmOverride: true })
    if (r.published) published++
    else if (!r.pending) failed++
  }
  return { published, failed }
}
