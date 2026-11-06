import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'crypto'
import { requirePortalPermission } from '@/lib/portal-auth'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

const BUCKET = 'contracts'

// POST (multipart) — klant voegt een idee toe aan een shoot van zijn eigen klant.
export async function POST(req: NextRequest) {
  try {
    const g = await requirePortalPermission('social_media', 'feedback')
    if (!g.ok) return g.response
    const { session } = g

    const fd = await req.formData()
    const shootId = fd.get('shoot_id') as string
    const title = (fd.get('title') as string)?.trim()
    const description = (fd.get('description') as string)?.trim()
    if (!shootId || (!title && !description)) return NextResponse.json({ error: 'Titel of omschrijving vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: shoot } = await admin.from('shoot_briefings').select('id, client_id').eq('id', shootId).maybeSingle()
    if (!shoot || shoot.client_id !== session.clientId) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    // Optionele upload
    let attachmentPath: string | null = null
    const file = fd.get('attachment') as File | null
    if (file && file.size > 0) {
      const ext = (file.name.split('.').pop() ?? 'jpg').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'jpg'
      const path = `shoot-ideas/${session.clientId}/${randomUUID()}.${ext}`
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'image/jpeg', upsert: false })
      if (!upErr) attachmentPath = path
    }

    const { error } = await admin.from('shoot_ideas').insert({
      shoot_id: shootId, client_id: session.clientId, title: title || null, description: description || null,
      attachment_path: attachmentPath, status: 'new',
    })
    if (error) throw new Error(error.message)

    try { revalidatePath('/portal/social-media') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?id= — klant verwijdert een eigen idee
export async function DELETE(req: NextRequest) {
  try {
    const g = await requirePortalPermission('social_media', 'feedback')
    if (!g.ok) return g.response
    const { session } = g

    const id = req.nextUrl.searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    // Eigendomscheck: hoort het idee bij deze klant?
    const { data: idea } = await admin.from('shoot_ideas').select('id, client_id').eq('id', id).maybeSingle()
    if (!idea || idea.client_id !== session.clientId) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const { error } = await admin.from('shoot_ideas').delete().eq('id', id)
    if (error) throw new Error(error.message)

    try { revalidatePath('/portal/social-media') } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
