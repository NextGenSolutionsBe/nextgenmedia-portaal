import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { bekijkLink, ShootFout, uploadLink } from '@/lib/shoots/server'

export const dynamic = 'force-dynamic'

const fout = (e: unknown) => e instanceof ShootFout ? NextResponse.json({ error: e.message }, { status: e.status }) : NextResponse.json({ error: safeMessage(e, 'shoots.upload') }, { status: 500 })

/** POST { naam, grootte, type } — ondertekende uploadlink: de browser laadt rechtstreeks op in de privébucket. */
export async function POST(req: NextRequest) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as { naam?: string; grootte?: number; type?: string }
    return NextResponse.json(await uploadLink(createAdminSupabaseClient(), String(b.naam ?? 'briefing'), Number(b.grootte), String(b.type ?? '')))
  } catch (e) { return fout(e) }
}

/** GET ?pad= — het briefingdocument bekijken (kortlevende link). */
export async function GET(req: NextRequest) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    return NextResponse.redirect(await bekijkLink(createAdminSupabaseClient(), String(req.nextUrl.searchParams.get('pad') ?? '')))
  } catch (e) { return fout(e) }
}
