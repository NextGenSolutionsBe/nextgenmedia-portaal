import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { naOfferteAkkoord } from '@/lib/opdrachten-offertes'
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
    const b = await req.json().catch(() => ({})) as { naam?: unknown; akkoord_voorwaarden?: unknown; akkoord_privacy?: unknown; handtekening?: unknown }
    const meta = requestMeta(req)
    const admin = createAdminSupabaseClient()
    const o = await accepteer(admin, params.token, { naam: b.naam, akkoord_voorwaarden: b.akkoord_voorwaarden, akkoord_privacy: b.akkoord_privacy, handtekening: b.handtekening, ip: meta.ip, ua: meta.userAgent })
    // Projecten: kaart met de groene label en de taak "contract opmaken of in gang zetten" (na het antwoord).
    if (o.status === 'geaccepteerd') waitUntil(naOfferteAkkoord(admin, o.id).catch((e) => console.warn('[offertes] na akkoord mislukt:', e instanceof Error ? e.message : e)))
    return NextResponse.json({ ok: true, geaccepteerd_op: o.geaccepteerd_op, geaccepteerd_door: o.geaccepteerd_door })
  } catch (e) {
    if (e instanceof OfferteFout) return NextResponse.json({ error: e.publiek }, { status: e.status })
    return NextResponse.json({ error: 'Er ging iets mis. Probeer het zo opnieuw.' }, { status: 500 })
  }
}
