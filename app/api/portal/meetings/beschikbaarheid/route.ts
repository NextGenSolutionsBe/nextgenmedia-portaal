import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission } from '@/lib/portal-auth'
import { rateLimit } from '@/lib/rate-limit'
import { perDag } from '@/lib/meetings/klantboeking'
import { berekenVrijeSlots, klantappMeeting, BoekingFout } from '@/lib/meetings/klantboeking-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Klantapp — vrije momenten (11:00–17:00, minstens 72 uur vooraf, 30 minuten).
 * Enkel begintijden: nooit titels, namen of andere info uit de agenda of ClickUp.
 * ?verplaats=<id>: bij het verplaatsen van een eigen boeking telt die zelf niet als bezet.
 */
export async function GET(req: NextRequest) {
  const g = await requirePortalPermission('meetings', 'book')
  if (!g.ok) return g.response
  const rl = await rateLimit(`kb:klantapp:vrij:${g.session.userId}`, { limit: 60, windowSec: 600 })
  if (!rl.allowed) return NextResponse.json({ error: 'Even te veel aanvragen. Probeer het zo meteen opnieuw.' }, { status: 429 })
  try {
    const admin = createAdminSupabaseClient()
    const eigen = req.nextUrl.searchParams.get('verplaats')
    const m = eigen ? await klantappMeeting(admin, g.session.clientId, eigen) : null
    if (eigen && !m) return NextResponse.json({ error: 'Meeting niet gevonden.' }, { status: 404 })
    const b = await berekenVrijeSlots(admin, { negeerMeetingId: m?.id })
    return NextResponse.json({ dagen: perDag(b.slots) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    if (e instanceof BoekingFout) {
      if (e.intern) console.error('[portal:meetings:vrij]', e.intern)
      return NextResponse.json({ error: e.publiek }, { status: e.status })
    }
    console.error('[portal:meetings:vrij]', e)
    return NextResponse.json({ error: 'Boeken is tijdelijk niet mogelijk. Probeer het later opnieuw of mail ons op info@nextgenmedia.be.' }, { status: 503 })
  }
}
