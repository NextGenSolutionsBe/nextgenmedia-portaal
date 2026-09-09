import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { randomUUID } from 'crypto'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

const BUCKET = 'contracts'

async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  return data?.role === 'admin' || (await isActiveStaff(user.id)) ? user : null
}

// POST (multipart) — admin registreert een betaling (meteen goedgekeurd).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params

    const fd = await req.formData()
    const direction = fd.get('direction') as string
    const amount = Number(fd.get('amount'))
    const paidOn = (fd.get('paid_on') as string) || new Date().toISOString().slice(0, 10)
    const note = (fd.get('note') as string)?.trim() || null
    if (!['we_pay_partner', 'partner_pays_us'].includes(direction)) return NextResponse.json({ error: 'Ongeldige richting' }, { status: 400 })
    if (!amount || amount <= 0) return NextResponse.json({ error: 'Bedrag is verplicht' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: partner } = await admin.from('freelancers').select('id').eq('id', id).maybeSingle()
    if (!partner) return NextResponse.json({ error: 'Partner niet gevonden' }, { status: 404 })

    let proofPath: string | null = null
    const file = fd.get('proof') as File | null
    if (file && file.size > 0) {
      const ext = (file.name.split('.').pop() ?? 'pdf').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'pdf'
      const path = `partner-payments/${id}/${randomUUID()}.${ext}`
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream', upsert: false })
      if (!upErr) proofPath = path
    }

    const nowIso = new Date().toISOString()
    const { data, error } = await admin.from('partner_payments').insert({
      freelancer_id: id, direction, amount, paid_on: paidOn, note, proof_path: proofPath,
      status: 'approved', created_by_role: 'admin', created_by: user.id, approved_by: user.id, approved_at: nowIso,
    }).select('id').single()
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'partner.payment.register', entityType: 'partner_payment', entityId: data.id,
      summary: `Betaling geregistreerd (${direction}, €${amount})`, actorUserId: user.id, actorEmail: user.email ?? null, actorRole: 'admin',
      metadata: { partner_id: id, direction, amount }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ id: data.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// PATCH { payment_id, status } — goedkeuren of annuleren (nooit verwijderen).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const { payment_id, status } = await req.json()
    if (!payment_id) return NextResponse.json({ error: 'payment_id vereist' }, { status: 400 })
    if (!['approved', 'cancelled'].includes(status)) return NextResponse.json({ error: 'Ongeldige status' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: existing } = await admin.from('partner_payments').select('id, status').eq('id', payment_id).eq('freelancer_id', id).maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Betaling niet gevonden' }, { status: 404 })

    const patch: Record<string, unknown> = { status }
    if (status === 'approved') { patch.approved_by = user.id; patch.approved_at = new Date().toISOString() }
    const { error } = await admin.from('partner_payments').update(patch).eq('id', payment_id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    await logAudit({
      action: 'partner.payment.status', entityType: 'partner_payment', entityId: payment_id,
      summary: `Betaling → ${status}`, actorUserId: user.id, actorEmail: user.email ?? null, actorRole: 'admin',
      metadata: { partner_id: id, status }, ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
