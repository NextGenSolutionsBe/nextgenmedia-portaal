import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'
import { framerConfigured, framerApiKey, addFields, renameField, removeFields, listCollectionsWithSchema } from '@/lib/framer-cms'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Veldtypes die de klant zelf mag aanmaken. Bewust een leesbare, beperkte set:
// referenties/arrays vragen technische kennis en horen bij ons, niet bij de klant.
const CREATABLE_FIELD_TYPES = [
  { type: 'string', label: 'Korte tekst' },
  { type: 'formattedText', label: 'Lange tekst' },
  { type: 'number', label: 'Getal' },
  { type: 'boolean', label: 'Aan/uit' },
  { type: 'date', label: 'Datum' },
  { type: 'image', label: 'Afbeelding' },
  { type: 'file', label: 'Bestand' },
  { type: 'link', label: 'Link' },
  { type: 'color', label: 'Kleur' },
  { type: 'enum', label: 'Keuzelijst' },
]
const ALLOWED = new Set(CREATABLE_FIELD_TYPES.map((f) => f.type))

/** Collectie van de ingelogde klant ophalen (en dat die bewerkbaar is). */
async function resolveCollection(clientId: string, collectionId: string) {
  const admin = createAdminSupabaseClient()
  const { data: col } = await admin
    .from('cms_collections')
    .select('id, framer_collection_id')
    .eq('id', collectionId).eq('client_id', clientId).eq('client_editable', true)
    .maybeSingle()
  if (!col) return null
  const { data: client } = await admin
    .from('clients').select('id, cms_enabled, framer_project_url, framer_api_key').eq('id', clientId).maybeSingle()
  if (!client?.cms_enabled || !framerConfigured(client)) return null
  return { admin, col, projectUrl: client.framer_project_url as string, apiKey: framerApiKey(client) }
}

/** Na een structuurwijziging: velden opnieuw uit Framer lezen en spiegelen. */
async function refreshFields(ctx: NonNullable<Awaited<ReturnType<typeof resolveCollection>>>) {
  const live = await listCollectionsWithSchema(ctx.projectUrl, ctx.apiKey)
  const match = live.find((c) => c.id === ctx.col.framer_collection_id)
  if (match) {
    await ctx.admin.from('cms_collections')
      .update({ fields: match.fields, synced_at: new Date().toISOString() })
      .eq('id', ctx.col.id)
  }
  return match?.fields ?? []
}

// POST — nieuw veld toevoegen. body: { collectionId, name, type, cases? }
export async function POST(req: NextRequest) {
  const g = await requirePortalPermission('cms', 'edit')
  if (!g.ok) return g.response
  try {
    const { collectionId, name, type, cases } = await req.json()
    const label = String(name ?? '').trim()
    if (!label) return NextResponse.json({ error: 'Geef het veld een naam' }, { status: 400 })
    if (!ALLOWED.has(String(type))) return NextResponse.json({ error: 'Onbekend veldtype' }, { status: 400 })
    if (type === 'enum' && (!Array.isArray(cases) || cases.filter((c: string) => String(c).trim()).length === 0)) {
      return NextResponse.json({ error: 'Geef minstens één keuze-optie op' }, { status: 400 })
    }

    const ctx = await resolveCollection(g.session.clientId, String(collectionId))
    if (!ctx) return NextResponse.json({ error: 'Geen toegang tot deze collectie' }, { status: 403 })

    await addFields(ctx.projectUrl, ctx.apiKey, ctx.col.framer_collection_id, [{
      name: label, type: String(type),
      cases: Array.isArray(cases) ? cases.map((c: string) => String(c).trim()).filter(Boolean) : undefined,
    }])
    const fields = await refreshFields(ctx)

    await logPortalAction(g.session, 'cms.field.create', { type: 'cms_collection', id: ctx.col.id }, { req, meta: { name: label, type } })
    return NextResponse.json({ ok: true, fields })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH — veld hernoemen. body: { collectionId, fieldId, name }
export async function PATCH(req: NextRequest) {
  const g = await requirePortalPermission('cms', 'edit')
  if (!g.ok) return g.response
  try {
    const { collectionId, fieldId, name } = await req.json()
    const label = String(name ?? '').trim()
    if (!label) return NextResponse.json({ error: 'Geef het veld een naam' }, { status: 400 })

    const ctx = await resolveCollection(g.session.clientId, String(collectionId))
    if (!ctx) return NextResponse.json({ error: 'Geen toegang tot deze collectie' }, { status: 403 })

    await renameField(ctx.projectUrl, ctx.apiKey, ctx.col.framer_collection_id, String(fieldId), label)
    const fields = await refreshFields(ctx)

    await logPortalAction(g.session, 'cms.field.rename', { type: 'cms_collection', id: ctx.col.id }, { req, meta: { fieldId, name: label } })
    return NextResponse.json({ ok: true, fields })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?collectionId=…&fieldId=… — veld verwijderen (ook de inhoud ervan).
export async function DELETE(req: NextRequest) {
  const g = await requirePortalPermission('cms', 'edit')
  if (!g.ok) return g.response
  try {
    const collectionId = req.nextUrl.searchParams.get('collectionId') ?? ''
    const fieldId = req.nextUrl.searchParams.get('fieldId') ?? ''
    if (!collectionId || !fieldId) return NextResponse.json({ error: 'collectionId en fieldId vereist' }, { status: 400 })

    const ctx = await resolveCollection(g.session.clientId, collectionId)
    if (!ctx) return NextResponse.json({ error: 'Geen toegang tot deze collectie' }, { status: 403 })

    await removeFields(ctx.projectUrl, ctx.apiKey, ctx.col.framer_collection_id, [fieldId])
    const fields = await refreshFields(ctx)

    // Waarde van het verwijderde veld ook uit de werkkopie halen.
    const { data: rows } = await ctx.admin.from('cms_items').select('id, field_data').eq('collection_id', ctx.col.id)
    for (const r of rows ?? []) {
      const fd = (r.field_data ?? {}) as Record<string, unknown>
      if (fieldId in fd) { delete fd[fieldId]; await ctx.admin.from('cms_items').update({ field_data: fd }).eq('id', r.id) }
    }

    await logPortalAction(g.session, 'cms.field.delete', { type: 'cms_collection', id: ctx.col.id }, { req, meta: { fieldId } })
    return NextResponse.json({ ok: true, fields })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
