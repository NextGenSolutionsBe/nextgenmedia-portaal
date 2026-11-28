import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { mailVoorbereiden, ShootFout, verstuurMail } from '@/lib/shoots/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const fout = (e: unknown) => e instanceof ShootFout ? NextResponse.json({ error: e.message }, { status: e.status }) : NextResponse.json({ error: safeMessage(e, 'shoots.mail') }, { status: 500 })

/** Wie de mail kan krijgen en een voorstel van tekst (voor de MailComposer). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const { id } = await params
  try { return NextResponse.json(await mailVoorbereiden(createAdminSupabaseClient(), id)) } catch (e) { return fout(e) }
}

/** POST { to_email, naam, subject, body, cta_text, verzend_sleutel, merk, bijlage } — één ontvanger, na voorbeeld en bevestiging. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireStaff()
  if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const { id } = await params
  try {
    const r = await verstuurMail(createAdminSupabaseClient(), id, (await req.json().catch(() => ({}))) as Record<string, unknown>, { userId: user.id, email: user.email ?? null })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) { return fout(e) }
}
