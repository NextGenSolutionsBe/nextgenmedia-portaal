import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, audit, BUCKET } from '@/lib/personeel/server'
import { isUuid, MAX_FOTO_BYTES } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

const MAX_DIRECT = 15 * 1024 * 1024
const FOTO_TYPE = /^image\/(jpeg|png|webp|gif)$/

/**
 * Profielfoto instellen of vervangen, zo vaak als je wil.
 *
 * POST (JSON { mimetype, grootte }) → ondertekende uploadlink: de browser laadt
 * de (verkleinde) foto rechtstreeks op in de opslag, zodat Vercel nooit een te
 * groot verzoek krijgt (413). PUT { pad } → die foto op het dossier zetten en
 * de oude opruimen. POST met een bestand (multipart) blijft werken voor kleine
 * foto's. DELETE → verwijderen.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    if ((req.headers.get('content-type') ?? '').includes('application/json')) {
      const b = await req.json().catch(() => ({})) as { mimetype?: unknown; grootte?: unknown }
      const type = String(b.mimetype ?? '')
      if (!FOTO_TYPE.test(type)) return NextResponse.json({ error: 'Enkel JPG, PNG, WebP of GIF.' }, { status: 400 })
      const grootte = Number(b.grootte)
      if (!Number.isFinite(grootte) || grootte <= 0) return NextResponse.json({ error: 'Kies een foto.' }, { status: 400 })
      if (grootte > MAX_DIRECT) return NextResponse.json({ error: 'Die foto is groter dan 15 MB.' }, { status: 400 })
      const { data: p } = await g.admin.from('personeel').select('id').eq('id', id).maybeSingle()
      if (!p) return NextResponse.json({ error: 'Medewerker niet gevonden' }, { status: 404 })
      const pad = `${id}/foto/${crypto.randomUUID()}.${type.split('/')[1]}`
      const { data, error } = await g.admin.storage.from(BUCKET).createSignedUploadUrl(pad)
      if (error || !data) throw new Error(error?.message ?? 'Uploadlink maken mislukt')
      return NextResponse.json({ bucket: BUCKET, pad, token: data.token })
    }
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

/** PUT { pad } — de net opgeladen foto op het dossier zetten (na de ondertekende upload). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    const b = await req.json().catch(() => ({})) as { pad?: unknown }
    const pad = String(b.pad ?? '')
    // Enkel een foto in de eigen map van deze medewerker, met de naam die POST gaf.
    const m = pad.match(new RegExp(`^${id}/foto/([0-9a-f-]{36}\\.(jpeg|png|webp|gif))$`))
    if (!m) return NextResponse.json({ error: 'Onbekende foto.' }, { status: 400 })
    const { data: lijst, error: le } = await g.admin.storage.from(BUCKET).list(`${id}/foto`, { search: m[1], limit: 5 })
    if (le) throw new Error(le.message)
    const obj = (lijst ?? []).find((o: { name: string }) => o.name === m[1]) as { name: string; metadata?: { size?: number; mimetype?: string } } | undefined
    if (!obj) return NextResponse.json({ error: 'De foto is niet aangekomen. Probeer opnieuw.' }, { status: 400 })
    const size = Number(obj.metadata?.size ?? 0), mime = String(obj.metadata?.mimetype ?? '')
    if (size > MAX_DIRECT || (mime && !FOTO_TYPE.test(mime))) {
      await g.admin.storage.from(BUCKET).remove([pad])
      return NextResponse.json({ error: 'Enkel een foto tot 15 MB (JPG, PNG, WebP of GIF).' }, { status: 400 })
    }
    const { data: p } = await g.admin.from('personeel').select('profielfoto_pad').eq('id', id).maybeSingle()
    if (!p) { await g.admin.storage.from(BUCKET).remove([pad]); return NextResponse.json({ error: 'Medewerker niet gevonden' }, { status: 404 }) }
    const { error } = await g.admin.from('personeel').update({ profielfoto_pad: pad, updated_at: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message)
    if (p.profielfoto_pad && p.profielfoto_pad !== pad) await g.admin.storage.from(BUCKET).remove([String(p.profielfoto_pad)])
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
