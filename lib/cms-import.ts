import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { framerConfigured, framerApiKey, listCollectionsWithSchema, getCollectionItems } from '@/lib/framer-cms'
import { mirrorSyncedItems } from '@/lib/cms-mirror'

export type ImportSummary = { collections: number; items: number; editableCollections: number }

/**
 * Haalt de VOLLEDIGE Framer-CMS van een klant op (collecties + velden + items)
 * en spiegelt die naar cms_collections/cms_items. Bestaande keuzes
 * (client_editable) en lokale wijzigingen blijven behouden.
 *
 * Gebruikt door zowel de knop "Ophalen" als het opslaan van de koppeling, zodat
 * de klant direct een gevulde CMS heeft zonder extra handeling.
 */
export async function importFramerCms(clientId: string): Promise<ImportSummary> {
  const admin = createAdminSupabaseClient()
  const { data: client } = await admin
    .from('clients').select('id, framer_project_url, framer_api_key').eq('id', clientId).maybeSingle()
  if (!client) throw new Error('Klant niet gevonden')
  if (!framerConfigured(client)) throw new Error('Projectlink + API-sleutel eerst instellen')

  const projectUrl = client.framer_project_url as string
  const apiKey = framerApiKey(client)

  const collections = await listCollectionsWithSchema(projectUrl, apiKey)

  // Eerder gemaakte keuzes per collectie bewaren.
  const { data: existing } = await admin
    .from('cms_collections').select('framer_collection_id, client_editable').eq('client_id', clientId)
  const editableMap = new Map((existing ?? []).map((r) => [r.framer_collection_id, r.client_editable]))

  const summary: ImportSummary = { collections: collections.length, items: 0, editableCollections: 0 }

  for (const col of collections) {
    const items = col.editable ? await getCollectionItems(projectUrl, apiKey, col.id) : []
    const clientEditable = editableMap.has(col.id) ? !!editableMap.get(col.id) : col.editable

    const { data: colRow, error: colErr } = await admin
      .from('cms_collections')
      .upsert({
        client_id: clientId,
        framer_collection_id: col.id,
        name: col.name,
        slug: col.slugField,
        fields: col.fields,
        client_editable: clientEditable,
        item_count: items.length,
        synced_at: new Date().toISOString(),
      }, { onConflict: 'client_id,framer_collection_id' })
      .select('id')
      .single()
    if (colErr || !colRow) continue
    if (clientEditable) summary.editableCollections++

    if (col.editable && items.length > 0) {
      await mirrorSyncedItems(admin, colRow.id, items)
      summary.items += items.length
    }
  }

  return summary
}
