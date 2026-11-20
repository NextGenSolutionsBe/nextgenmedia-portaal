import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, magGevoelig, audit, BUCKET } from '@/lib/personeel/server'
import { isDocumentMap, mapLabel } from '@/lib/personeel/model'
import { tekst, dagOf, isUuid, veiligeBestandsnaam, MAX_DOCUMENT_BYTES } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Identiteitsdocumenten en payrollgegevens zijn gevoelig: enkel voor bevoegde admins. */
const GEVOELIG = ['identiteit', 'payroll']

async function magMap(map: string, persoon: Parameters<typeof magGevoelig>[0]) {
  return !GEVOELIG.includes(map) || (await magGevoelig(persoon))
}

/**
 * POST (multipart: file, map, vervalt_op?, verplicht?, vervang?) — uploaden of
 * vervangen. Vervangen houdt dezelfde rij (en dus de geschiedenis), het oude
 * bestand wordt verwijderd. Wie het document toevoegde of aanpaste, wordt bewaard.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const fd = await req.formData()
    const vervang = String(fd.get('vervang') ?? '')
    const g = await eisPersoneel(vervang ? 'aanpassen' : 'toevoegen'); if (!g.ok) return g.response
    const file = fd.get('file') as File | null
    if (!file || file.size === 0) return NextResponse.json({ error: 'Kies een bestand.' }, { status: 400 })
    if (file.size > MAX_DOCUMENT_BYTES) return NextResponse.json({ error: 'Maximaal 20 MB per document.' }, { status: 400 })
    const map = String(fd.get('map') ?? 'overig')
    if (!isDocumentMap(map)) return NextResponse.json({ error: 'Onbekende documentmap.' }, { status: 400 })
    if (!(await magMap(map, g.persoon))) return NextResponse.json({ error: 'Deze map is enkel voor bevoegde admins.' }, { status: 403 })
    const { data: p } = await g.admin.from('personeel').select('id').eq('id', id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Medewerker niet gevonden' }, { status: 404 })

    const pad = `${id}/${map}/${crypto.randomUUID()}-${veiligeBestandsnaam(file.name)}`
    const { error: upFout } = await g.admin.storage.from(BUCKET).upload(pad, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream', upsert: false })
    if (upFout) throw new Error(`Uploaden mislukt: ${upFout.message}`)
    const vervaltOp = dagOf(fd.get('vervalt_op')), verplicht = String(fd.get('verplicht') ?? '') === 'true'

    if (vervang) {
      if (!isUuid(vervang)) return NextResponse.json({ error: 'Ongeldig document' }, { status: 400 })
      const { data: oud } = await g.admin.from('personeel_documenten').select('*').eq('id', vervang).eq('personeel_id', id).maybeSingle()
      if (!oud) return NextResponse.json({ error: 'Document niet gevonden' }, { status: 404 })
      if (!(await magMap(String(oud.map), g.persoon))) return NextResponse.json({ error: 'Deze map is enkel voor bevoegde admins.' }, { status: 403 })
      await g.admin.from('personeel_documenten').update({ naam: file.name.slice(0, 200), pad, mime: file.type || null, grootte: file.size, map, vervalt_op: vervaltOp ?? oud.vervalt_op, gewijzigd_door: g.persoon.email, updated_at: new Date().toISOString() }).eq('id', vervang)
      await g.admin.storage.from(BUCKET).remove([String(oud.pad)])
      await audit(g.admin, { personeel_id: id, entiteit: 'document', entiteit_id: vervang, actie: 'document_vervangen', oud: { naam: oud.naam, map: oud.map }, nieuw: { naam: file.name, map }, actor_email: g.persoon.email, actor_id: g.persoon.userId })
      return NextResponse.json({ ok: true, id: vervang })
    }

    const { data, error } = await g.admin.from('personeel_documenten').insert({
      personeel_id: id, map, naam: file.name.slice(0, 200), pad, mime: file.type || null, grootte: file.size, vervalt_op: vervaltOp, verplicht,
      toegevoegd_door: g.persoon.email, gewijzigd_door: g.persoon.email,
    }).select('id').single()
    if (error) { await g.admin.storage.from(BUCKET).remove([pad]); throw new Error(error.message) }
    await audit(g.admin, { personeel_id: id, entiteit: 'document', entiteit_id: data.id, actie: 'document_toegevoegd', nieuw: { naam: file.name, map: mapLabel(map), vervalt_op: vervaltOp }, actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** PATCH { doc, naam?, map?, vervalt_op?, verplicht? } — gegevens van een document aanpassen. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    if (!isUuid(id) || !isUuid(b.doc)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const { data: oud } = await g.admin.from('personeel_documenten').select('*').eq('id', b.doc).eq('personeel_id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Document niet gevonden' }, { status: 404 })
    const patch: Record<string, unknown> = { gewijzigd_door: g.persoon.email, updated_at: new Date().toISOString() }
    if ('naam' in b) patch.naam = tekst(b.naam, 200) ?? oud.naam
    if ('map' in b) { if (!isDocumentMap(b.map)) return NextResponse.json({ error: 'Onbekende map.' }, { status: 400 }); patch.map = b.map }
    if ('vervalt_op' in b) patch.vervalt_op = dagOf(b.vervalt_op)
    if ('verplicht' in b) patch.verplicht = b.verplicht === true
    for (const m of [String(oud.map), String(patch.map ?? oud.map)]) if (!(await magMap(m, g.persoon))) return NextResponse.json({ error: 'Deze map is enkel voor bevoegde admins.' }, { status: 403 })
    const { error: updErr } = await g.admin.from('personeel_documenten').update(patch).eq('id', oud.id)
    if (updErr) throw new Error(updErr.message)
    await audit(g.admin, { personeel_id: id, entiteit: 'document', entiteit_id: oud.id, actie: 'document_gewijzigd', oud: { naam: oud.naam, map: oud.map, vervalt_op: oud.vervalt_op, verplicht: oud.verplicht }, nieuw: patch, actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** DELETE ?doc=<id> — document en bestand verwijderen (volgens het recht "verwijderen"). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const doc = req.nextUrl.searchParams.get('doc')
    if (!isUuid(id) || !isUuid(doc)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('verwijderen'); if (!g.ok) return g.response
    const { data: oud } = await g.admin.from('personeel_documenten').select('*').eq('id', doc).eq('personeel_id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Document niet gevonden' }, { status: 404 })
    if (!(await magMap(String(oud.map), g.persoon))) return NextResponse.json({ error: 'Deze map is enkel voor bevoegde admins.' }, { status: 403 })
    await g.admin.from('personeel_documenten').delete().eq('id', doc)
    await g.admin.storage.from(BUCKET).remove([String(oud.pad)])
    await audit(g.admin, { personeel_id: id, entiteit: 'document', entiteit_id: doc, actie: 'document_verwijderd', oud: { naam: oud.naam, map: oud.map }, actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
