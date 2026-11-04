import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { accepteer, OfferteFout } from '@/lib/offertes-server'
import { requestMeta } from '@/lib/audit'

export const dynamic = 'force-dynamic'

/**
 * Publiek: de klant accepteert de offerte. Token-gated (enkel wie de link
 * heeft), enkel een verstuurde en nog geldige offerte, en twee keer klikken
 * telt één keer.
 */
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  try {
    const b = await req.json().catch(() => ({})) as { naam?: unknown }
    const meta = requestMeta(req)
    const o = await accepteer(createAdminSupabaseClient(), params.token, { naam: b.naam, ip: meta.ip, ua: meta.userAgent })
    return NextResponse.json({ ok: true, geaccepteerd_op: o.geaccepteerd_op, geaccepteerd_door: o.geaccepteerd_door })
  } catch (e) {
    if (e instanceof OfferteFout) return NextResponse.json({ error: e.publiek }, { status: e.status })
    return NextResponse.json({ error: 'Er ging iets mis. Probeer het zo opnieuw.' }, { status: 500 })
  }
}
