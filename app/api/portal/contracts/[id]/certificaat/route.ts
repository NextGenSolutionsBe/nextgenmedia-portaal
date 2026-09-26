import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, canAccessContract, logPortalAction } from '@/lib/portal-auth'
import { haalCertificaat } from '@/lib/contract-archief'
import { contentDisposition } from '@/lib/contract-archief-model'
import { logContractEvent } from '@/lib/contract-audit'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * GET — het ondertekeningscertificaat van een eigen getekend contract, voor
 * de klant in het portaal. Zelfde recht als het getekende contract downloaden
 * (contracts.download, via canAccessContract).
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const g = await requirePortalPermission('contracts', 'download')
    if (!g.ok) return g.response
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: c } = await admin.from('contracts').select('id, status, client_id').eq('id', id).maybeSingle()
    if (!c || !canAccessContract(g.session, c, 'download')) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })
    if (String(c.status) !== 'signed' && String(c.status) !== 'getekend') return NextResponse.json({ error: 'Enkel een getekend contract heeft een certificaat.' }, { status: 400 })

    const { bytes, bestandsnaam, archief } = await haalCertificaat(admin, id)
    await Promise.all([
      logPortalAction(g.session, 'contract.certificaat.download', { type: 'contract', id }, { req, meta: { certificaat_nr: archief.certificaatNr, versie: archief.versie } }),
      logContractEvent(admin, id, 'downloaded', { actor: g.session.email ?? null, meta: { wat: 'certificaat', via: 'portaal', certificaat_nr: archief.certificaatNr } }),
    ])
    return new NextResponse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': contentDisposition(bestandsnaam, 'attachment'),
        'Cache-Control': 'private, no-store',
      },
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
