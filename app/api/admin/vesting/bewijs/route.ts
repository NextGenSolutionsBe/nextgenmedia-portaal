import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { BewijsFout, bewijsLink, bewijsUploadLink } from '@/lib/vesting-bewijs-server'

export const dynamic = 'force-dynamic'

/** POST { naam, grootte } — een ondertekende uploadlink voor een bewijsstuk (pdf, jpg, png; max 25 MB). */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as { naam?: unknown; grootte?: unknown }
    const link = await bewijsUploadLink(createAdminSupabaseClient(), String(b.naam ?? ''), Number(b.grootte))
    return NextResponse.json(link)
  } catch (e) {
    return NextResponse.json({ error: e instanceof BewijsFout ? e.message : safeMessage(e, 'Uploadlink maken mislukt') }, { status: e instanceof BewijsFout ? 400 : 500 })
  }
}

/** GET ?pad=bewijs/… — het bewijsstuk bekijken (kortlevende link). Enkel bestanden die echt aan een inkomst of kost hangen. */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const pad = req.nextUrl.searchParams.get('pad') ?? ''
  if (!/^bewijs\/[0-9a-f-]{36}\/[^/]+$/i.test(pad)) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
  const admin = createAdminSupabaseClient()
  const [r, k] = await Promise.all([
    admin.from('vesting_registraties').select('id').eq('bewijs_pad', pad).limit(1),
    admin.from('vesting_kosten').select('id').eq('bewijs_pad', pad).limit(1),
  ])
  if (!(r.data?.length || k.data?.length)) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 })
  const url = await bewijsLink(admin, pad)
  if (!url) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 })
  return NextResponse.redirect(url)
}
