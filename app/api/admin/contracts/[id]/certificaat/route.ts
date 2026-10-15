import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { haalCertificaat } from '@/lib/contract-archief'
import { contentDisposition } from '@/lib/contract-archief-model'
import { logContractEvent } from '@/lib/contract-audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET — het ondertekeningscertificaat (PDF) van een getekend contract.
 * Komt uit het contractarchief; bestaat er nog geen archiefversie (oudere
 * contracten), dan wordt het contract eerst gearchiveerd.
 * `?weergave=inline` opent het in de browser i.p.v. te downloaden.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: c } = await admin.from('contracts').select('id, status').eq('id', id).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })
    if (String(c.status) !== 'signed' && String(c.status) !== 'getekend') return NextResponse.json({ error: 'Enkel een getekend contract heeft een certificaat.' }, { status: 400 })

    const { bytes, bestandsnaam, archief } = await haalCertificaat(admin, id)
    const inline = req.nextUrl.searchParams.get('weergave') === 'inline'
    await logContractEvent(admin, id, 'downloaded', { actor: actor.email ?? null, meta: { wat: 'certificaat', certificaat_nr: archief.certificaatNr, versie: archief.versie } })
    return new NextResponse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition(bestandsnaam, inline ? 'inline' : 'attachment'),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
