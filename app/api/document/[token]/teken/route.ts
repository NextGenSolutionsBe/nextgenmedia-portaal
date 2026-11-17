import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { requestMeta } from '@/lib/audit'
import { AcFout, tekenPartij } from '@/lib/algemene-contracten/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** POST { naam, handtekening, akkoord } — de andere partij tekent met de persoonlijke link (geen login). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  try {
    const m = requestMeta(req)
    const r = await tekenPartij(createAdminSupabaseClient(), token, (await req.json().catch(() => ({}))) as Record<string, unknown>, { ip: m.ip, ua: m.userAgent })
    return NextResponse.json({ ok: true, ...r })
  } catch (e) {
    return e instanceof AcFout ? NextResponse.json({ error: e.message }, { status: e.status }) : NextResponse.json({ error: safeMessage(e, 'document.teken') }, { status: 500 })
  }
}
