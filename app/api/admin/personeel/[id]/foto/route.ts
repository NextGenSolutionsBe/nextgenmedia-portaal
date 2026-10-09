import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, audit, BUCKET } from '@/lib/personeel/server'
import { isUuid, MAX_FOTO_BYTES } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/** POST (multipart: file) — profielfoto instellen of vervangen. DELETE — verwijderen. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    const file = (await req.formData()).get('file') as File | null
    if (!file || file.size === 0) return NextResponse.json({ error: 'Kies een foto.' }, { status: 400 })
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) return NextResponse.json({ error: 'Enkel JPG, PNG, WebP of GIF.' }, { status: 400 })
    if (file.size > MAX_FOTO_BYTES) return NextResponse.json({ error: 'Maximaal 5 MB.' }, { status: 400 })
    const { data: p } = await g.admin.from('personeel').select('profielfoto_pad').eq('id', id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Medewerker niet gevonden' }, { status: 404 })
    const pad = `${id}/foto/${crypto.randomUUID()}.${file.type.split('/')[1]}`
    const { error } = await g.admin.storage.from(BUCKET).upload(pad, Buffer.from(await file.arrayBuffer()), { contentType: file.type })
    if (error) throw new Error(error.message)
    await g.admin.from('personeel').update({ profielfoto_pad: pad, updated_at: new Date().toISOString() }).eq('id', id)
    if (p.profielfoto_pad) await g.admin.storage.from(BUCKET).remove([String(p.profielfoto_pad)])
    await audit(g.admin, { personeel_id: id, entiteit: 'medewerker', entiteit_id: id, actie: 'profielfoto_gewijzigd', actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    const { data: p } = await g.admin.from('personeel').select('profielfoto_pad').eq('id', id).maybeSingle()
    if (p?.profielfoto_pad) await g.admin.storage.from(BUCKET).remove([String(p.profielfoto_pad)])
    await g.admin.from('personeel').update({ profielfoto_pad: null }).eq('id', id)
    await audit(g.admin, { personeel_id: id, entiteit: 'medewerker', entiteit_id: id, actie: 'profielfoto_verwijderd', actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
