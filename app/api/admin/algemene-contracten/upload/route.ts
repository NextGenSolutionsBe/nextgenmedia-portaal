import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { AcFout, uploadLink } from '@/lib/algemene-contracten/server'

export const dynamic = 'force-dynamic'

/** POST { naam, grootte } — een ondertekende uploadlink voor een PDF (max 50 MB). */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as { naam?: unknown; grootte?: unknown }
    return NextResponse.json(await uploadLink(createAdminSupabaseClient(), String(b.naam ?? ''), Number(b.grootte)))
  } catch (e) {
    return e instanceof AcFout ? NextResponse.json({ error: e.message }, { status: e.status }) : NextResponse.json({ error: safeMessage(e, 'Uploadlink maken mislukt') }, { status: 500 })
  }
}
