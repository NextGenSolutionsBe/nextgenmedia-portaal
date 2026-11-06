import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

// Verifieert dat een collectie van de ingelogde klant is én bewerkbaar.
async function ownsCollection(admin: ReturnType<typeof createAdminSupabaseClient>, clientId: string, collectionId: string) {
  const { data } = await admin
    .from('cms_collections')
    .select('id')
    .eq('id', collectionId)
    .eq('client_id', clientId)
    .eq('client_editable', true)
    .maybeSingle()
  return !!data
}

// POST — item aanmaken of bijwerken in de werkkopie (nog niet naar Framer).
// body: { id?, collectionId, slug, values }
export async function POST(req: NextRequest) {
  const g = await requirePortalPermission('cms', 'edit')
  if (!g.ok) return g.response
  try {
    const { id, collectionId, slug, values } = await req.json()
    if (!collectionId) return NextResponse.json({ error: 'collectionId vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    if (!(await ownsCollection(admin, g.session.clientId, collectionId))) {
      return NextResponse.json({ error: 'Geen toegang tot deze collectie' }, { status: 403 })
    }

    const fieldData = (values && typeof values === 'object') ? values : {}
    if (id) {
      const { data: existing } = await admin.from('cms_items').select('id, status, framer_item_id').eq('id', id).eq('collection_id', collectionId).maybeSingle()
      if (!existing) return NextResponse.json({ error: 'Item niet gevonden' }, { status: 404 })
      // 'new' blijft 'new' tot publiceren; anders wordt het 'dirty'.
      const nextStatus = existing.status === 'new' ? 'new' : 'dirty'
      const { error } = await admin.from('cms_items').update({ slug: slug ?? null, field_data: fieldData, status: nextStatus }).eq('id', id)
      if (error) throw new Error(error.message)
      await logPortalAction(g.session, 'cms.item.update', { type: 'cms_item', id }, { req })
      return NextResponse.json({ ok: true, id })
    }

    const { data: row, error } = await admin.from('cms_items').insert({
      collection_id: collectionId, framer_item_id: null, slug: slug ?? null, field_data: fieldData, status: 'new',
    }).select('id').single()
    if (error) throw new Error(error.message)
    await logPortalAction(g.session, 'cms.item.create', { type: 'cms_item', id: row.id }, { req })
    return NextResponse.json({ ok: true, id: row.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?id=... — nieuw item meteen weg; bestaand item markeren voor
// verwijdering bij de volgende publicatie.
export async function DELETE(req: NextRequest) {
  const g = await requirePortalPermission('cms', 'edit')
  if (!g.ok) return g.response
  try {
    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })
    const admin = createAdminSupabaseClient()

    // Bevestig eigenaarschap via de collectie.
    const { data: item } = await admin.from('cms_items').select('id, collection_id, status').eq('id', id).maybeSingle()
    if (!item) return NextResponse.json({ error: 'Item niet gevonden' }, { status: 404 })
    if (!(await ownsCollection(admin, g.session.clientId, item.collection_id))) {
      return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    }

    if (item.status === 'new') {
      await admin.from('cms_items').delete().eq('id', id)
    } else {
      await admin.from('cms_items').update({ status: 'deleted' }).eq('id', id)
    }
    await logPortalAction(g.session, 'cms.item.delete', { type: 'cms_item', id }, { req })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
