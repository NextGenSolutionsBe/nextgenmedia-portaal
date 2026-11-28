import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'
import { framerConfigured, framerApiKey, pushItems, removeItems, publishSite, type FramerField, type PushItem } from '@/lib/framer-cms'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

// POST — publiceer de werkkopie naar de Framer-website: nieuwe/gewijzigde items
// terugschrijven, verwijderde items schrappen, daarna publiceren + deployen.
export async function POST(req: NextRequest) {
  const g = await requirePortalPermission('cms', 'publish')
  if (!g.ok) return g.response
  try {
    const admin = createAdminSupabaseClient()
    const { data: client } = await admin
      .from('clients').select('id, cms_enabled, framer_project_url, framer_api_key').eq('id', g.session.clientId).maybeSingle()
    if (!client?.cms_enabled) return NextResponse.json({ error: 'CMS niet ingeschakeld' }, { status: 400 })
    if (!framerConfigured(client)) return NextResponse.json({ error: 'Framer niet geconfigureerd' }, { status: 400 })

    const projectUrl = client.framer_project_url as string
    const apiKey = framerApiKey(client)

    const { data: cols } = await admin
      .from('cms_collections')
      .select('id, framer_collection_id, fields')
      .eq('client_id', g.session.clientId)
      .eq('client_editable', true)
    const collections = cols ?? []

    const summary = { pushed: 0, deleted: 0, collections: 0 }
    const errors: Array<{ collection: string; error: string }> = []

    for (const col of collections) {
      const { data: rows } = await admin
        .from('cms_items')
        .select('id, framer_item_id, slug, field_data, status')
        .eq('collection_id', col.id)
        .in('status', ['new', 'dirty', 'deleted'])
      const dirty = rows ?? []
      if (dirty.length === 0) continue

      const fields = (Array.isArray(col.fields) ? col.fields : []) as FramerField[]

      try {
        // 1) Verwijderde items schrappen in Framer.
        const toDelete = dirty.filter((r) => r.status === 'deleted' && r.framer_item_id)
        if (toDelete.length) {
          await removeItems(projectUrl, apiKey, col.framer_collection_id, toDelete.map((r) => r.framer_item_id as string))
          await admin.from('cms_items').delete().in('id', toDelete.map((r) => r.id))
          summary.deleted += toDelete.length
        }
        // Nieuwe items die lokaal als 'deleted' gemarkeerd zijn (nooit gepusht) → lokaal weg.
        const localDelete = dirty.filter((r) => r.status === 'deleted' && !r.framer_item_id)
        if (localDelete.length) await admin.from('cms_items').delete().in('id', localDelete.map((r) => r.id))

        // 2) Nieuwe + gewijzigde items terugschrijven (met stabiele slug per rij).
        const toPush = dirty.filter((r) => r.status === 'new' || r.status === 'dirty')
        if (toPush.length) {
          const withSlug = toPush.map((r, i) => ({ row: r, slug: r.slug || `item-${Date.now()}-${i}` }))
          const items: PushItem[] = withSlug.map(({ row, slug }) => ({
            framerItemId: row.framer_item_id,
            slug,
            values: (row.field_data && typeof row.field_data === 'object') ? (row.field_data as Record<string, string>) : {},
          }))
          const newIds = await pushItems(projectUrl, apiKey, col.framer_collection_id, fields, items)
          for (const { row, slug } of withSlug) {
            const patch: Record<string, unknown> = { status: 'synced' }
            if (!row.framer_item_id && newIds[slug]) patch.framer_item_id = newIds[slug]
            if (!row.slug) patch.slug = slug
            await admin.from('cms_items').update(patch).eq('id', row.id)
          }
          summary.pushed += toPush.length
        }
        summary.collections++
      } catch (e) {
        errors.push({ collection: col.framer_collection_id, error: e instanceof Error ? e.message : 'Fout' })
      }
    }

    // 3) Publiceren + live zetten (ook als sommige collecties faalden — de wél
    //    doorgeschreven wijzigingen moeten live).
    let published = true
    let publishWarning: string | null = null
    try {
      await publishSite(projectUrl, apiKey)
    } catch (e) {
      published = false
      const msg = e instanceof Error ? e.message : 'Fout'
      // Een publish-time-out is NIET fataal: de item-wijzigingen staan al in Framer;
      // de website-publicatie loopt op de achtergrond door. Toon een waarschuwing
      // i.p.v. een harde fout, zodat de klant niet denkt dat er iets misging.
      publishWarning = /tim(e|ed)[\s-]?out/i.test(msg)
        ? 'Je wijzigingen staan in Framer. Het live zetten van de website duurt iets langer en gebeurt op de achtergrond — bekijk je site over enkele minuten.'
        : `De website-publicatie is mogelijk niet voltooid: ${msg}`
    }

    await logPortalAction(g.session, 'cms.publish', { type: 'client', id: g.session.clientId }, { req, meta: { ...summary, itemErrors: errors.length, published } })

    // Alleen ECHTE schrijffouten (item toevoegen/bijwerken/verwijderen) zijn fataal.
    // Een mislukte/trage site-publicatie is een waarschuwing, geen blokkade.
    if (errors.length > 0) {
      return NextResponse.json({ ok: false, summary, published, error: errors.map((e) => `${e.collection}: ${e.error}`).join(' | '), errors }, { status: 400 })
    }
    return NextResponse.json({ ok: true, summary, published, publishWarning })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
