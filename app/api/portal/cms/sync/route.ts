import { safeMessage } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission } from '@/lib/portal-auth'
import { framerConfigured, framerApiKey, listCollectionsWithSchema, getCollectionItems } from '@/lib/framer-cms'
import { mirrorSyncedItems } from '@/lib/cms-mirror'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST — haalt de HUIDIGE collecties + items uit Framer op en werkt de werkkopie
// bij, zodat de klant altijd de actuele website-content ziet. Lokale wijzigingen
// (new/dirty/deleted) blijven behouden; enkel 'synced'-rijen worden ververst.
export async function POST() {
  const g = await requirePortalPermission('cms', 'edit')
  if (!g.ok) return g.response
  try {
    const admin = createAdminSupabaseClient()
    const { data: client } = await admin
      .from('clients').select('id, cms_enabled, framer_project_url, framer_api_key').eq('id', g.session.clientId).maybeSingle()
    if (!client?.cms_enabled) return NextResponse.json({ error: 'CMS niet ingeschakeld' }, { status: 400 })
    if (!framerConfigured(client)) return NextResponse.json({ error: 'Framer niet geconfigureerd' }, { status: 400 })

    const projectUrl = client.framer_project_url as string
    const apiKey = framerApiKey(client)

    // Enkel de door de klant bewerkbare collecties.
    const { data: editableCols } = await admin
      .from('cms_collections').select('id, framer_collection_id').eq('client_id', g.session.clientId).eq('client_editable', true)
    const editableIds = new Set((editableCols ?? []).map((c) => c.framer_collection_id))
    if (editableIds.size === 0) return NextResponse.json({ ok: true, synced: 0 })

    const collections = await listCollectionsWithSchema(projectUrl, apiKey)
    let syncedItems = 0

    for (const col of collections) {
      if (!editableIds.has(col.id)) continue
      const { data: colRow } = await admin
        .from('cms_collections')
        .select('id')
        .eq('client_id', g.session.clientId)
        .eq('framer_collection_id', col.id)
        .maybeSingle()
      if (!colRow) continue

      // Velden + item-aantal bijwerken.
      const items = await getCollectionItems(projectUrl, apiKey, col.id)
      await admin.from('cms_collections').update({ fields: col.fields, item_count: items.length, synced_at: new Date().toISOString() }).eq('id', colRow.id)

      // Live items spiegelen (manueel update-of-insert; synced-rijen worden
      // ververst, lokale new/dirty/deleted blijven behouden — zie cms-mirror).
      syncedItems += await mirrorSyncedItems(admin, colRow.id, items)
    }

    return NextResponse.json({ ok: true, synced: syncedItems })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
