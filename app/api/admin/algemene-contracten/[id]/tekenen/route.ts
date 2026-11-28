import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { requestMeta } from '@/lib/audit'
import { leesProfiel } from '@/lib/account-server'
import { AcFout, tekenOns } from '@/lib/algemene-contracten/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST { handtekening (PNG data-URL), zone, partij_zone? } — een zaakvoerder tekent namens NextGenMedia. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await requireAdmin()
  if (!user) return NextResponse.json({ error: 'Enkel een zaakvoerder kan namens NextGenMedia tekenen.' }, { status: 403 })
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
  try {
    const profiel = await leesProfiel(user).catch(() => null)
    const naam = (profiel ? `${profiel.voornaam} ${profiel.achternaam}`.trim() : '') || (user.email ?? '').split('@')[0]
    const m = requestMeta(req)
    const r = await tekenOns(createAdminSupabaseClient(), id, (await req.json().catch(() => ({}))) as Record<string, unknown>, { userId: user.id, email: user.email ?? null, naam, ip: m.ip, ua: m.userAgent })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return e instanceof AcFout ? NextResponse.json({ error: e.message }, { status: e.status }) : NextResponse.json({ error: safeMessage(e, 'algemene-contracten.tekenen') }, { status: 500 })
  }
}
