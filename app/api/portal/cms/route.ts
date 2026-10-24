import { safeMessage } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

// GET — de bewerkbare CMS-collecties + items van de ingelogde klant (werkkopie).
export async function GET() {
  const g = await requirePortalPermission('cms', 'view')
  if (!g.ok) return g.response
  try {
    const admin = createAdminSupabaseClient()
    const { data: client } = await admin
      .from('clients').select('id, cms_enabled').eq('id', g.session.clientId).maybeSingle()
    if (!client?.cms_enabled) return NextResponse.json({ enabled: false, collections: [] })

    const { data: cols } = await admin
      .from('cms_collections')
      .select('id, framer_collection_id, name, slug, fields, item_count')
      .eq('client_id', g.session.clientId)
      .eq('client_editable', true)
      .order('name', { ascending: true })

    const collectionIds = (cols ?? []).map((c) => c.id)
    let items: unknown[] = []
    if (collectionIds.length > 0) {
      // Ook 'deleted'-items teruggeven: de client verbergt ze uit de lijst, maar
      // telt ze mee als openstaande wijziging zodat de publiceer-knop actief wordt
      // en de verwijdering naar Framer wordt doorgezet.
      const { data } = await admin
        .from('cms_items')
        .select('id, collection_id, framer_item_id, slug, field_data, status, position')
        .in('collection_id', collectionIds)
        .order('position', { ascending: true })
      items = data ?? []
    }

    return NextResponse.json({ enabled: true, collections: cols ?? [], items })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
