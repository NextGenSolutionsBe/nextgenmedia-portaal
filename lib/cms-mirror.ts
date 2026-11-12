import type { SupabaseClient } from '@supabase/supabase-js'
import type { FramerItem } from '@/lib/framer-cms'

// Spiegelt de LIVE Framer-items naar cms_items voor één collectie.
// Bewust GEEN .upsert({ onConflict }): de unieke index cms_items_framer_key is
// partieel (WHERE framer_item_id IS NOT NULL) en PostgREST kan een partiële index
// niet als ON CONFLICT-doel matchen → de upsert zou stil falen. Daarom manueel
// "update-of-insert" op framer_item_id.
//
// - Enkel 'synced'-rijen worden overschreven; lokale new/dirty/deleted blijven staan.
// - Synced-rijen waarvan het item niet meer in Framer bestaat, worden verwijderd.
// Geeft het aantal verwerkte live-items terug.
export async function mirrorSyncedItems(
  admin: SupabaseClient,
  collectionRowId: string,
  items: FramerItem[],
): Promise<number> {
  const { data: current } = await admin
    .from('cms_items')
    .select('id, framer_item_id, status')
    .eq('collection_id', collectionRowId)
  const rows = current ?? []
  const byFid = new Map(rows.filter((r) => r.framer_item_id).map((r) => [r.framer_item_id as string, r]))
  const liveIds = new Set(items.map((it) => it.framerItemId))

  // Synced-rijen die niet meer in Framer bestaan → opruimen.
  const gone = rows.filter((r) => r.status === 'synced' && r.framer_item_id && !liveIds.has(r.framer_item_id))
  if (gone.length) await admin.from('cms_items').delete().in('id', gone.map((r) => r.id))

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const existing = byFid.get(it.framerItemId)
    if (existing) {
      // Lokale wijziging (new/dirty/deleted) niet overschrijven.
      if (existing.status === 'synced') {
        await admin.from('cms_items')
          .update({ slug: it.slug, field_data: it.values, position: i })
          .eq('id', existing.id)
      }
    } else {
      await admin.from('cms_items').insert({
        collection_id: collectionRowId,
        framer_item_id: it.framerItemId,
        slug: it.slug,
        field_data: it.values,
        status: 'synced',
        position: i,
      })
    }
  }
  return items.length
}
