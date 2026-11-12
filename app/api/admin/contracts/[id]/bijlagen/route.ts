import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { logContractEvent } from '@/lib/contract-audit'
import { veiligeBestandsnaam } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/**
 * Bijlagen bij een contract (bv. het mailverkeer waarin de klant bevestigde,
 * bij "op getekend zetten"). Privé opslag in de contracts-bucket; openen gaat
 * via een kortlevende ondertekende link.
 *  GET → lijst · GET ?bijlage= → openen (redirect) · POST (formData: file) · DELETE ?bijlage=
 */

const BUCKET = 'contracts'
// Vercel weigert request-bodies boven ~4,5 MB.
const MAX_BYTES = 4 * 1024 * 1024
const UUID = /^[0-9a-f-]{36}$/i
const VELDEN = 'id, naam, grootte, mime, created_by, created_at'

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig contract' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const bijlage = req.nextUrl.searchParams.get('bijlage')
    if (bijlage) {
      if (!UUID.test(bijlage)) return NextResponse.json({ error: 'Ongeldige bijlage' }, { status: 400 })
      const { data } = await admin.from('contract_bijlagen').select('pad, naam').eq('id', bijlage).eq('contract_id', id).maybeSingle()
      if (!data) return NextResponse.json({ error: 'Bijlage niet gevonden' }, { status: 404 })
      const { data: url, error } = await admin.storage.from(BUCKET).createSignedUrl(String(data.pad), 300, { download: String(data.naam) })
      if (error || !url) throw new Error(error?.message ?? 'Openen mislukt')
      return NextResponse.redirect(url.signedUrl)
    }
    const { data } = await admin.from('contract_bijlagen').select(VELDEN).eq('contract_id', id).order('created_at')
    return NextResponse.json({ bijlagen: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig contract' }, { status: 400 })
    const fd = await req.formData()
    const file = fd.get('file')
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: 'Kies een bestand.' }, { status: 400 })
    if (file.size > MAX_BYTES) return NextResponse.json({ error: 'Maximaal 4 MB per bijlage.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: contract } = await admin.from('contracts').select('id, client_id').eq('id', id).maybeSingle()
    if (!contract) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })
    const pad = `bijlagen/${id}/${randomUUID()}-${veiligeBestandsnaam(file.name || 'bijlage')}`
    const { error: up } = await admin.storage.from(BUCKET).upload(pad, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream', upsert: false })
    if (up) throw new Error(up.message)
    const naam = (file.name || 'bijlage').slice(0, 200)
    const { data, error } = await admin.from('contract_bijlagen').insert({ contract_id: id, naam, pad, grootte: file.size, mime: file.type || null, created_by: actor.email ?? null }).select(VELDEN).single()
    if (error) { await admin.storage.from(BUCKET).remove([pad]); throw new Error(error.message) }
    await logContractEvent(admin, id, 'bijlage_toegevoegd', { actor: actor.email ?? actor.id, meta: { naam } })
    try { revalidatePath(`/admin/contracts/${id}`) } catch { }
    return NextResponse.json({ bijlage: data })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const bijlage = req.nextUrl.searchParams.get('bijlage') ?? ''
    if (!UUID.test(id) || !UUID.test(bijlage)) return NextResponse.json({ error: 'Ongeldige bijlage' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: oud } = await admin.from('contract_bijlagen').select('pad, naam').eq('id', bijlage).eq('contract_id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Bijlage niet gevonden' }, { status: 404 })
    const { error } = await admin.from('contract_bijlagen').delete().eq('id', bijlage)
    if (error) throw new Error(error.message)
    try { await admin.storage.from(BUCKET).remove([String(oud.pad)]) } catch { /* bestand al weg */ }
    await logContractEvent(admin, id, 'bijlage_verwijderd', { actor: actor.email ?? actor.id, meta: { naam: oud.naam } })
    const meta = requestMeta(req)
    await logAudit({ action: 'contract.bijlage_verwijderd', entityType: 'contract', entityId: id, summary: `Bijlage "${oud.naam}" verwijderd`, actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'staff', ip: meta.ip, userAgent: meta.userAgent })
    try { revalidatePath(`/admin/contracts/${id}`) } catch { }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
