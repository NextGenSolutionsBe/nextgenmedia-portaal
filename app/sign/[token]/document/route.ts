import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// Streamt het contract-PDF server-side (service-role) op basis van de publieke
// tekentoken. Vervangt de ingesloten Supabase signed-URL (die verliep → InvalidJWT):
// geen vervaltijd, geen cache-probleem. Token-gated: enkel via een geldig
// access_token bereikbaar.
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const admin = createAdminSupabaseClient()
    const { data: contract } = await admin
      .from('contracts')
      .select('id, status, pdf_path, signed_pdf_path')
      .eq('access_token', params.token)
      .maybeSingle()
    if (!contract) return new NextResponse('Niet gevonden', { status: 404 })

    const signed = contract.status === 'signed' || contract.status === 'getekend'
    const path = (signed && contract.signed_pdf_path) ? contract.signed_pdf_path : contract.pdf_path
    if (!path) return new NextResponse('Geen document', { status: 404 })

    const { data, error } = await admin.storage.from('contracts').download(path)
    if (error || !data) return new NextResponse('Document niet beschikbaar', { status: 404 })

    const buf = Buffer.from(await data.arrayBuffer())
    return new NextResponse(buf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="contract.pdf"',
        'Cache-Control': 'private, no-store',
      },
    })
  } catch {
    return new NextResponse('Fout', { status: 500 })
  }
}
