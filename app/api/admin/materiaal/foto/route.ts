import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

/** Foto van een materiaalitem (privé-bucket). POST multipart {item_id, file}; DELETE ?item_id=… */
const BUCKET = 'documenten'
const UUID = /^[0-9a-f-]{36}$/i
const TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic' }

export async function POST(req: NextRequest) {
  try {
    if (!(await magIk('materiaal', 'instellingen'))) return NextResponse.json({ error: 'Enkel een beheerder kan foto’s toevoegen.' }, { status: 403 })
    const fd = await req.formData()
    const id = String(fd.get('item_id') ?? ''), file = fd.get('file')
    if (!UUID.test(id) || !(file instanceof File)) return NextResponse.json({ error: 'Kies een foto.' }, { status: 400 })
    const ext = TYPES[file.type]
    if (!ext) return NextResponse.json({ error: 'Enkel JPG, PNG, WEBP of HEIC.' }, { status: 400 })
    if (file.size > 8 * 1024 * 1024) return NextResponse.json({ error: 'De foto is groter dan 8 MB.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: item } = await admin.from('materiaal_items').select('id, foto_pad').eq('id', id).maybeSingle()
    if (!item) return NextResponse.json({ error: 'Materiaal niet gevonden.' }, { status: 404 })
    const pad = `materiaal/${id}/${Date.now()}.${ext}`
    const { error: up } = await admin.storage.from(BUCKET).upload(pad, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false })
    if (up) throw new Error(up.message)
    const { error } = await admin.from('materiaal_items').update({ foto_pad: pad, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) { await admin.storage.from(BUCKET).remove([pad]); throw new Error(error.message) }
    if (item.foto_pad) await admin.storage.from(BUCKET).remove([item.foto_pad])
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    if (!(await magIk('materiaal', 'instellingen'))) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('item_id') ?? ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: item } = await admin.from('materiaal_items').select('foto_pad').eq('id', id).maybeSingle()
    if (item?.foto_pad) { await admin.storage.from(BUCKET).remove([item.foto_pad]); await admin.from('materiaal_items').update({ foto_pad: null }).eq('id', id) }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
