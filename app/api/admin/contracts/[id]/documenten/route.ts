import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { haalBeideDocumenten, combineerPdfs } from '@/lib/contract-archief'
import { contentDisposition, documentBestandsnaam } from '@/lib/contract-archief-model'
import { logContractEvent } from '@/lib/contract-audit'
import { writeZip } from '@/lib/zip'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET ?formaat=zip|pdf — het getekende contract én het certificaat samen.
 *  - zip: beide PDF's als download ("Beide documenten downloaden")
 *  - pdf: één gecombineerde PDF, contract eerst en dan het certificaat,
 *         inline in een nieuw tabblad ("Beide documenten afdrukken")
 * Beide komen uit het beschermde contractarchief.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const formaat = req.nextUrl.searchParams.get('formaat') === 'pdf' ? 'pdf' : 'zip'

    const admin = createAdminSupabaseClient()
    const { data: c } = await admin.from('contracts').select('id, status').eq('id', id).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })
    if (String(c.status) !== 'signed' && String(c.status) !== 'getekend') return NextResponse.json({ error: 'Enkel een getekend contract heeft getekende documenten.' }, { status: 400 })

    const { contract, certificaat, archief } = await haalBeideDocumenten(admin, id)
    const d = archief.dossier
    await logContractEvent(admin, id, 'downloaded', { actor: actor.email ?? null, meta: { wat: formaat === 'pdf' ? 'beide_pdf' : 'beide_zip', certificaat_nr: archief.certificaatNr, versie: archief.versie } })

    if (formaat === 'pdf') {
      const samen = await combineerPdfs(contract.bytes, certificaat.bytes, `${d.titel} — getekend contract en ondertekeningscertificaat`)
      const naam = documentBestandsnaam('beide_pdf', d.klantNaam, d.titel, d.signedAt)
      return new NextResponse(samen.buffer.slice(samen.byteOffset, samen.byteOffset + samen.byteLength) as ArrayBuffer, {
        headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': contentDisposition(naam, 'inline'), 'Cache-Control': 'private, no-store' },
      })
    }

    const zip = writeZip([
      { name: contract.bestandsnaam, data: Buffer.from(contract.bytes) },
      { name: certificaat.bestandsnaam, data: Buffer.from(certificaat.bytes) },
    ])
    const naam = documentBestandsnaam('beide_zip', d.klantNaam, d.titel, d.signedAt)
    return new NextResponse(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength) as ArrayBuffer, {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': contentDisposition(naam, 'attachment'), 'Cache-Control': 'private, no-store' },
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
