import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { UitgaveFout, bonLink, bonUploadLink } from '@/lib/vennoot-uitgaven-server'

export const dynamic = 'force-dynamic'

/** POST { naam, grootte } — ondertekende uploadlink voor een bonnetje of factuur (foto of pdf, max 25 MB). */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as { naam?: unknown; grootte?: unknown }
    return NextResponse.json(await bonUploadLink(createAdminSupabaseClient(), String(b.naam ?? ''), Number(b.grootte)))
  } catch (e) {
    return NextResponse.json({ error: e instanceof UitgaveFout ? e.message : safeMessage(e, 'Uploadlink maken mislukt') }, { status: e instanceof UitgaveFout ? 400 : 500 })
  }
}

/** GET ?pad=bonnen/… — het bonnetje bekijken (kortlevende link), enkel als het aan een uitgave hangt. */
export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const url = await bonLink(createAdminSupabaseClient(), req.nextUrl.searchParams.get('pad') ?? '')
  if (!url) return NextResponse.json({ error: 'Niet gevonden.' }, { status: 404 })
  return NextResponse.redirect(url)
}
