import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient } from '@/lib/supabase/server'
import { randomUUID } from 'crypto'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

const BUCKET = 'contracts'

// POST (multipart) — partner registreert een betaling. Start als 'pending';
// admin moet goedkeuren voordat het saldo aangepast wordt.
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

    const { data: partner } = await supabase.from('freelancers').select('id').eq('user_id', user.id).maybeSingle()
    if (!partner) return NextResponse.json({ error: 'Geen partnerprofiel' }, { status: 403 })

    const fd = await req.formData()
    const direction = fd.get('direction') as string
    const amount = Number(fd.get('amount'))
    const paidOn = (fd.get('paid_on') as string) || new Date().toISOString().slice(0, 10)
    const note = (fd.get('note') as string)?.trim() || null
    if (!['we_pay_partner', 'partner_pays_us'].includes(direction)) return NextResponse.json({ error: 'Ongeldige richting' }, { status: 400 })
    if (!amount || amount <= 0) return NextResponse.json({ error: 'Bedrag is verplicht' }, { status: 400 })

    const admin = createAdminSupabaseClient()

    let proofPath: string | null = null
    const file = fd.get('proof') as File | null
    if (file && file.size > 0) {
      const ext = (file.name.split('.').pop() ?? 'pdf').replace(/[^a-z0-9]/gi, '').toLowerCase() || 'pdf'
      const path = `partner-payments/${partner.id}/${randomUUID()}.${ext}`
      const { error: upErr } = await admin.storage.from(BUCKET).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type || 'application/octet-stream', upsert: false })
      if (!upErr) proofPath = path
    }

    const { error } = await admin.from('partner_payments').insert({
      freelancer_id: partner.id, direction, amount, paid_on: paidOn, note, proof_path: proofPath,
      status: 'pending', created_by_role: 'partner', created_by: user.id,
    })
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
