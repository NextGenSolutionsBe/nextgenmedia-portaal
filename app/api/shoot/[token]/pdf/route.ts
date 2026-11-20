import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { vindLink } from '@/lib/shoots/server'
import { maakShootplanPdf, shootplanBestandsnaam } from '@/lib/shoots/pdf'

export const dynamic = 'force-dynamic'

/** Het shootplan als pdf, enkel met de persoonlijke link uit de mail (eigen controle: token, niet verlopen). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const l = await vindLink(createAdminSupabaseClient(), token).catch(() => null)
  if (!l) return NextResponse.json({ error: 'Deze link werkt niet meer.' }, { status: 404 })
  try {
    const pdf = await maakShootplanPdf(l.shoot)
    return new NextResponse(Buffer.from(pdf), {
      headers: {
        'Content-Type': 'application/pdf', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex',
        'Content-Disposition': `${req.nextUrl.searchParams.get('download') === '1' ? 'attachment' : 'inline'}; filename="${shootplanBestandsnaam(l.shoot)}"`,
      },
    })
  } catch { return NextResponse.json({ error: 'Het shootplan kon niet gemaakt worden.' }, { status: 500 }) }
}
