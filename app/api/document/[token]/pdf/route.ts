import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { pdfLink, vindLink } from '@/lib/algemene-contracten/server'

export const dynamic = 'force-dynamic'

/** GET ?download=1 — publiek met de persoonlijke link: de huidige versie van het document (kortlevende link). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const admin = createAdminSupabaseClient()
  const l = await vindLink(admin, token)
  if (!l) return NextResponse.json({ error: 'Deze link werkt niet meer.' }, { status: 404 })
  const url = await pdfLink(admin, l.contract, { download: req.nextUrl.searchParams.get('download') === '1', seconden: 120 })
  if (!url) return NextResponse.json({ error: 'Het document werd niet gevonden.' }, { status: 404 })
  return NextResponse.redirect(url)
}
