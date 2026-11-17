import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { AcFout, laadContract, pdfLink } from '@/lib/algemene-contracten/server'

export const dynamic = 'force-dynamic'

/** GET ?origineel=1&download=1 — de huidige versie (met alle handtekeningen) of het origineel, via een kortlevende link. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
  try {
    const admin = createAdminSupabaseClient()
    const sp = req.nextUrl.searchParams
    const url = await pdfLink(admin, await laadContract(admin, id), { origineel: sp.get('origineel') === '1', download: sp.get('download') === '1' })
    if (!url) return NextResponse.json({ error: 'De PDF werd niet gevonden.' }, { status: 404 })
    return NextResponse.redirect(url)
  } catch (e) {
    return NextResponse.json({ error: e instanceof AcFout ? e.message : 'Niet gevonden' }, { status: e instanceof AcFout ? e.status : 404 })
  }
}
