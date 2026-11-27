import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { AcFout, leesOpgeladenPdf } from '@/lib/algemene-contracten/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST { pad } — een net opgeladen PDF laten lezen; het antwoord is enkel een voorstel om velden in te vullen. */
export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as { pad?: unknown }
    const voorstel = await leesOpgeladenPdf(createAdminSupabaseClient(), b.pad)
    return NextResponse.json({ voorstel })
  } catch (e) {
    return e instanceof AcFout ? NextResponse.json({ error: e.message }, { status: e.status }) : NextResponse.json({ error: safeMessage(e, 'PDF lezen mislukt') }, { status: 500 })
  }
}
