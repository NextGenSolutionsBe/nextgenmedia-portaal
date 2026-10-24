import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { veiligeBestandsnaam } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/**
 * Bijlagen bij een facturatie-item (bestelbon, bewijs van een extra kost …).
 * Privé opslag; openen gaat via een kortlevende ondertekende link.
 *  GET ?invoice_id=  → lijst · GET ?id= → openen (redirect) · POST (formData: file, invoice_id) · DELETE ?id=
 */

const BUCKET = 'documenten'
const MAX_BYTES = 15 * 1024 * 1024
const UUID = /^[0-9a-f-]{36}$/i

export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const id = req.nextUrl.searchParams.get('id')
    if (id) {
      if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldige bijlage' }, { status: 400 })
      const { data } = await admin.from('invoice_bijlagen').select('pad, naam').eq('id', id).maybeSingle()
      if (!data) return NextResponse.json({ error: 'Bijlage niet gevonden' }, { status: 404 })
      const { data: url, error } = await admin.storage.from(BUCKET).createSignedUrl(String(data.pad), 300, { download: String(data.naam) })
      if (error || !url) throw new Error(error?.message ?? 'Openen mislukt')
      return NextResponse.redirect(url.signedUrl)
    }
    const inv = req.nextUrl.searchParams.get('invoice_id') ?? ''
    if (!UUID.test(inv)) return NextResponse.json({ error: 'Ongeldig item' }, { status: 400 })
    const { data } = await admin.from('invoice_bijlagen').select('id, naam, grootte, mime, created_by, created_at').eq('invoice_id', inv).order('created_at')
    return NextResponse.json({ bijlagen: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const fd = await req.formData()
    const file = fd.get('file')
    const inv = String(fd.get('invoice_id') ?? '')
    if (!UUID.test(inv)) return NextResponse.json({ error: 'Ongeldig item' }, { status: 400 })
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Kies een bestand.' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Maximaal 15 MB per bijlage.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: factuur } = await admin.from('invoices').select('id').eq('id', inv).maybeSingle()
    if (!factuur) return NextResponse.json({ error: 'Item niet gevonden' }, { status: 404 })
    const naam = veiligeBestandsnaam(file.name || 'bijlage')
    const pad = `facturen/${inv}/${randomUUID()}-${naam}`
    const { error: up } = await admin.storage.from(BUCKET).upload(pad, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream', upsert: false })
    if (up) throw new Error(up.message)
    const { data, error } = await admin.from('invoice_bijlagen').insert({ invoice_id: inv, naam: file.name.slice(0, 200) || naam, pad, grootte: file.size, mime: file.type || null, created_by: actor.email ?? null }).select('id, naam, grootte, mime, created_by, created_at').single()
    if (error) { await admin.storage.from(BUCKET).remove([pad]); throw new Error(error.message) }
    try { await admin.from('invoice_wijzigingen').insert({ invoice_id: inv, actie: 'aangepast', veld: 'bijlage', oud: null, nieuw: data.naam, actor_email: actor.email ?? null }) } catch { /* */ }
    return NextResponse.json({ bijlage: data })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldige bijlage' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: oud } = await admin.from('invoice_bijlagen').select('invoice_id, pad, naam').eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Bijlage niet gevonden' }, { status: 404 })
    const { error } = await admin.from('invoice_bijlagen').delete().eq('id', id)
    if (error) throw new Error(error.message)
    await admin.storage.from(BUCKET).remove([String(oud.pad)])
    try { await admin.from('invoice_wijzigingen').insert({ invoice_id: oud.invoice_id, actie: 'aangepast', veld: 'bijlage', oud: oud.naam, nieuw: null, reden: 'Bijlage verwijderd', actor_email: actor.email ?? null }) } catch { /* */ }
    const meta = requestMeta(req)
    await logAudit({ action: 'invoice.bijlage_verwijderd', entityType: 'invoice', entityId: String(oud.invoice_id), summary: `Bijlage "${oud.naam}" verwijderd`, actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
