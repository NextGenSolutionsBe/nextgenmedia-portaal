import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { slugify } from '@/lib/blog-ai'
import { publishBlogToFramer, markFramerSync, type FramerClientConfig } from '@/lib/framer'
import { snapshotBlogVersion, describeChanges } from '@/lib/blog-versions'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

// Opslaan pusht (bij gepubliceerde blogs) naar Framer — externe call, kan duren.
export const maxDuration = 60

const FRAMER_COLS = 'id, client_id, framer_project_url, framer_api_key, framer_blog_collection_id, framer_field_map'

// PATCH { id, titel?, content?, meta_title?, meta_description? }
// Klant bewerkt een blog van zijn gekoppelde blogaccount. Opslaan = (indien
// gepubliceerd + Framer geconfigureerd) automatisch pushen naar Framer + loggen
// wie de wijziging deed. Klanten kunnen blogs NIET verwijderen of genereren.
export async function PATCH(req: NextRequest) {
  try {
    const g = await requirePortalPermission('blogs', 'edit')
    if (!g.ok) return g.response
    const { session } = g
    const user = { id: session.userId, email: (session.email ?? undefined) as string | undefined }

    const b = await req.json()
    if (!b.id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: blog } = await admin.from('blogs').select('*').eq('id', b.id).maybeSingle()
    if (!blog) return NextResponse.json({ error: 'Blog niet gevonden' }, { status: 404 })

    // Eigendomscheck: blog → blogaccount → klant van de sessie.
    const { data: account } = await admin.from('blog_accounts').select(FRAMER_COLS).eq('id', blog.account_id).maybeSingle()
    const ownClient = account?.client_id === session.clientId
    const ownBlog = blog.client_id === session.clientId
    if (!ownClient && !ownBlog) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const fields: Record<string, unknown> = {}
    if (b.titel !== undefined) fields.titel = String(b.titel)
    if (b.slug !== undefined) fields.slug = slugify(String(b.slug))
    if (b.content !== undefined) fields.content = b.content
    if (b.meta_title !== undefined) fields.meta_title = b.meta_title
    if (b.meta_description !== undefined) fields.meta_description = b.meta_description
    if (b.thumbnail_url !== undefined) fields.thumbnail_url = b.thumbnail_url || null
    if (Object.keys(fields).length === 0) return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })

    // Versiegeschiedenis: huidige toestand bewaren vóór de wijziging.
    await snapshotBlogVersion(admin, blog.id, blog, user.email ?? user.id, describeChanges(blog, fields))

    const patch: Record<string, unknown> = {
      ...fields,
      laatst_bewerkt_door: user.email ?? user.id,
      laatst_bewerkt_op: new Date().toISOString(),
    }
    if (blog.status === 'gepubliceerd') patch.sync_status = 'pending'

    const { error } = await admin.from('blogs').update(patch).eq('id', b.id)
    if (error) throw new Error(error.message)

    const merged = { ...blog, ...patch }

    // Reeds gepubliceerd? Wijziging meteen naar Framer pushen.
    let pushed = false, pushError: string | null = null
    if (blog.status === 'gepubliceerd' && account) {
      const config: FramerClientConfig = {
        projectUrl: account.framer_project_url ?? null, apiKeyEncrypted: account.framer_api_key ?? null,
        collectionId: account.framer_blog_collection_id ?? null, fieldMap: (account.framer_field_map ?? null) as Record<string, string> | null,
      }
      const result = await publishBlogToFramer(config, {
        id: merged.id, titel: merged.titel, slug: merged.slug, content: merged.content,
        meta_title: merged.meta_title, meta_description: merged.meta_description, thumbnail_url: merged.thumbnail_url, framer_item_id: merged.framer_item_id,
      }, { confirmOverride: true, accountId: account.id })
      if (result.ok) {
        pushed = true
        const p: Record<string, unknown> = { gepubliceerd_op: new Date().toISOString(), foutmelding: null, sync_status: 'synced' }
        if (result.framerItemId) p.framer_item_id = result.framerItemId
        await admin.from('blogs').update(p).eq('id', b.id)
        await markFramerSync(account.id)
      } else if (!result.pending) {
        pushError = result.error ?? 'Publicatie mislukt'
        await admin.from('blogs').update({ sync_status: 'failed' }).eq('id', b.id)
      }
    }

    await logPortalAction(session, 'portal.blog.edited', { type: 'blog', id: b.id }, { req, meta: { pushed } })

    try { revalidatePath('/portal/blogs'); revalidatePath('/admin/blogs') } catch { }
    return NextResponse.json({ ok: true, pushed, pushError })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
