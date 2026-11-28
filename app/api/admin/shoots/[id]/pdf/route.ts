import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { laadShoot, ShootFout } from '@/lib/shoots/server'
import { maakShootplanPdf, shootplanBestandsnaam } from '@/lib/shoots/pdf'

export const dynamic = 'force-dynamic'

/** Het shootplan als pdf (?download=1 = opslaan in plaats van bekijken). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const { id } = await params
  try {
    const s = await laadShoot(createAdminSupabaseClient(), id)
    const pdf = await maakShootplanPdf(s)
    const naam = shootplanBestandsnaam(s)
    return new NextResponse(Buffer.from(pdf), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `${req.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${naam}"`, 'Cache-Control': 'no-store' },
    })
  } catch (e) {
    return e instanceof ShootFout ? NextResponse.json({ error: e.message }, { status: e.status }) : NextResponse.json({ error: safeMessage(e, 'shoots.pdf') }, { status: 500 })
  }
}
