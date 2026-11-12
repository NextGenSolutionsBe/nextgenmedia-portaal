import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { offerteVanToken, pdfVan } from '@/lib/offertes-server'
import { offerteBestandsnaam } from '@/lib/offertes'

export const dynamic = 'force-dynamic'

/** Streamt de pdf van een offerte op basis van de publieke token (geen verlopende link). */
export async function GET(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const admin = createAdminSupabaseClient()
    const o = await offerteVanToken(admin, params.token)
    if (!o || o.status === 'concept' || o.status === 'ingetrokken') return new NextResponse('Niet gevonden', { status: 404 })
    const buf = await pdfVan(admin, o)
    if (!buf) return new NextResponse('Document niet beschikbaar', { status: 404 })
    const download = req.nextUrl.searchParams.get('download') === '1'
    const naam = offerteBestandsnaam(o)
    return new NextResponse(new Uint8Array(buf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${naam.endsWith('.pdf') ? naam : `${naam}.pdf`}"`,
        'Cache-Control': 'private, no-store',
      },
    })
  } catch {
    return new NextResponse('Fout', { status: 500 })
  }
}
