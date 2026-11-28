import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { leesOfferte, pdfVan } from '@/lib/offertes-server'
import { offerteBestandsnaam } from '@/lib/offertes'

export const dynamic = 'force-dynamic'

/** De pdf van een offerte bekijken als team (telt niet als "geopend door de klant"). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const { id } = await params
  const admin = createAdminSupabaseClient()
  const o = await leesOfferte(admin, id)
  if (!o) return new NextResponse('Niet gevonden', { status: 404 })
  const buf = await pdfVan(admin, o, req.nextUrl.searchParams.get('origineel') === '1')
  if (!buf) return new NextResponse('Document niet beschikbaar', { status: 404 })
  return new NextResponse(new Uint8Array(buf), { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `${req.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${offerteBestandsnaam(o)}"`, "Cache-Control": "private, no-store" } })
}
