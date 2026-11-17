import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { AcFout, verstuurMail } from '@/lib/algemene-contracten/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST { to_email, subject, body, cta_text, verzend_sleutel, merk, bijlage } — vanuit de MailComposer (voorbeeld, nooit automatisch). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
  try {
    const r = await verstuurMail(createAdminSupabaseClient(), id, (await req.json().catch(() => ({}))) as Record<string, unknown>, { userId: user.id, email: user.email ?? null })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return e instanceof AcFout ? NextResponse.json({ error: e.message }, { status: e.status }) : NextResponse.json({ error: safeMessage(e, 'algemene-contracten.mail') }, { status: 500 })
  }
}
