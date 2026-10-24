import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { logAudit, requestMeta } from '@/lib/audit'
import { perDag } from '@/lib/meetings/klantboeking'
import {
  meetingVoorToken, publiekeWeergave, annuleerViaLink, verplaatsViaLink, berekenVrijeSlots, BoekingFout,
} from '@/lib/meetings/klantboeking-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Publiek: de klant beheert de eigen boeking met de persoonlijke link. Het
 * token komt in de body (niet in de URL van een verzoek), en geeft enkel
 * toegang tot die ene boeking.
 *  POST { token, actie: 'lees' | 'tijden' | 'annuleer' | 'verplaats', start? }
 */
export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const rl = await rateLimit(`kb:beheer:${ip}`, { limit: 40, windowSec: 600 })
  if (!rl.allowed) return NextResponse.json({ error: 'Even te veel aanvragen. Probeer het zo meteen opnieuw.' }, { status: 429 })
  const b = await req.json().catch(() => ({})) as { token?: unknown; actie?: string; start?: unknown }
  const admin = createAdminSupabaseClient()
  try {
    const m = await meetingVoorToken(admin, b.token)
    if (!m) return NextResponse.json({ error: 'Deze link werkt niet (meer). Gebruik de link uit je laatste bevestigingsmail.' }, { status: 404 })
    const { userAgent } = requestMeta(req)
    if (b.actie === 'lees') return NextResponse.json({ boeking: publiekeWeergave(m) })
    if (b.actie === 'tijden') {
      const v = await berekenVrijeSlots(admin, { negeerMeetingId: m.id })
      return NextResponse.json({ dagen: perDag(v.slots) })
    }
    if (b.actie === 'annuleer') {
      const x = await annuleerViaLink(admin, m)
      await logAudit({ action: 'klantboeking.geannuleerd', entityType: 'klant_meeting', entityId: m.id, actorEmail: 'klant (beheerlink)', ip, userAgent })
      return NextResponse.json({ boeking: publiekeWeergave(x) })
    }
    if (b.actie === 'verplaats') {
      const x = await verplaatsViaLink(admin, m, String(b.token), b.start)
      await logAudit({ action: 'klantboeking.verplaatst', entityType: 'klant_meeting', entityId: m.id, actorEmail: 'klant (beheerlink)', ip, userAgent, metadata: { naar: x.starts_at } })
      return NextResponse.json({ boeking: publiekeWeergave(x) })
    }
    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (e) {
    if (e instanceof BoekingFout) {
      if (e.intern) console.error('[boeken:beheer]', e.intern)
      return NextResponse.json({ error: e.publiek }, { status: e.status })
    }
    console.error('[boeken:beheer]', e)
    return NextResponse.json({ error: 'Er ging iets mis. Probeer het later opnieuw.' }, { status: 500 })
  }
}
