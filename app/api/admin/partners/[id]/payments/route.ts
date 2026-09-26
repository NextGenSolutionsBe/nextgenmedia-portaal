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

// PATCH { payment_id, status } — goedkeuren of annuleren.
// PATCH { payment_id, amount?, paid_on?, note? } — gegevens corrigeren.
// Het saldo wordt altijd afgeleid (verplichtingen − goedgekeurde betalingen,
// zie lib/partner-finance.ts), dus een correctie werkt meteen correct door.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const { payment_id, status } = body
    if (!payment_id) return NextResponse.json({ error: 'payment_id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: existing } = await admin.from('partner_payments').select('id, status, amount, paid_on, note').eq('id', payment_id).eq('freelancer_id', id).maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Betaling niet gevonden' }, { status: 404 })

    const patch: Record<string, unknown> = {}
    if (status !== undefined) {
      if (!['approved', 'cancelled'].includes(status)) return NextResponse.json({ error: 'Ongeldige status' }, { status: 400 })
      patch.status = status
      if (status === 'approved') { patch.approved_by = user.id; patch.approved_at = new Date().toISOString() }
    }
    if (body.amount !== undefined) {
      const n = Number(body.amount)
      if (!Number.isFinite(n) || n <= 0) return NextResponse.json({ error: 'Geef een geldig bedrag.' }, { status: 400 })
      patch.amount = n
    }
    if (body.paid_on !== undefined) {
      const d = String(body.paid_on ?? '')
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return NextResponse.json({ error: 'Ongeldige datum.' }, { status: 400 })
      patch.paid_on = d
    }
    if (body.note !== undefined) patch.note = String(body.note ?? '').trim().slice(0, 1000) || null
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'Geen wijzigingen' }, { status: 400 })

    const { error } = await admin.from('partner_payments').update(patch).eq('id', payment_id).eq('freelancer_id', id)
    if (error) throw new Error(error.message)

    const meta = requestMeta(req)
    const alleenStatus = status !== undefined && Object.keys(patch).every((k) => ['status', 'approved_by', 'approved_at'].includes(k))
    await logAudit({
      action: alleenStatus ? 'partner.payment.status' : 'partner.payment.update', entityType: 'partner_payment', entityId: payment_id,
      summary: alleenStatus ? `Betaling → ${status}` : 'Betaling bijgewerkt',
      actorUserId: user.id, actorEmail: user.email ?? null, actorRole: 'admin',
      metadata: { partner_id: id, velden: Object.keys(patch), oud: { amount: existing.amount, paid_on: existing.paid_on }, status },
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE ?payment_id= — enkel een betaling die (nog) niet meetelt: in afwachting
// of geannuleerd. Een goedgekeurde betaling vereffent het saldo; die moet eerst
// geannuleerd worden, zodat het wegvallen ervan een bewuste stap is.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAdmin()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const paymentId = req.nextUrl.searchParams.get('payment_id') ?? ''
    if (!paymentId) return NextResponse.json({ error: 'payment_id vereist' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: existing } = await admin.from('partner_payments')
      .select('id, status, amount, direction, proof_path').eq('id', paymentId).eq('freelancer_id', id).maybeSingle()
    if (!existing) return NextResponse.json({ error: 'Betaling niet gevonden' }, { status: 404 })
    if (existing.status === 'approved') {
      return NextResponse.json({ error: 'Een goedgekeurde betaling telt mee in het saldo. Annuleer ze eerst; daarna kun je ze verwijderen.' }, { status: 409 })
    }

    const { error } = await admin.from('partner_payments').delete().eq('id', paymentId).eq('freelancer_id', id)
    if (error) throw new Error(error.message)
    if (existing.proof_path) {
      try { await admin.storage.from(BUCKET).remove([existing.proof_path as string]) } catch { }
    }

    const meta = requestMeta(req)
    await logAudit({
      action: 'partner.payment.delete', entityType: 'partner_payment', entityId: paymentId,
      summary: `Betaling verwijderd (${existing.direction}, €${existing.amount}, status ${existing.status})`,
      actorUserId: user.id, actorEmail: user.email ?? null, actorRole: 'admin',
      metadata: { partner_id: id, amount: existing.amount, direction: existing.direction, status: existing.status },
      ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
