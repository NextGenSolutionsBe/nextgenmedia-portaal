import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { voorbeeldPdf } from '@/lib/offertes-opmaak-server'
import { fout } from '../_fout'

export const dynamic = 'force-dynamic'

/** POST → de pdf zoals hij eruit zal zien, zonder iets te bewaren (voorbeeld in het formulier). */
export async function POST(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const bytes = await voorbeeldPdf(createAdminSupabaseClient(), b)
    return new NextResponse(new Uint8Array(bytes), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="voorbeeld-offerte.pdf"', 'Cache-Control': 'no-store' } })
  } catch (e) { return fout(e, 'offertes.voorbeeld') }
}
