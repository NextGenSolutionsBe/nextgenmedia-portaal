import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { perDag, KB_DUUR_MIN, KB_MIN_VOORAF_TEKST, KB_VENSTER } from '@/lib/meetings/klantboeking'
import { berekenVrijeSlots, BoekingFout } from '@/lib/meetings/klantboeking-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Publiek: vrije momenten voor een gratis meeting. Enkel begintijden — nooit
 * titels, namen of andere details uit de agenda of ClickUp.
 */
export async function GET(req: NextRequest) {
  const rl = await rateLimit(`kb:beschikbaarheid:${clientIp(req)}`, { limit: 60, windowSec: 600 })
  if (!rl.allowed) return NextResponse.json({ error: 'Even te veel aanvragen. Probeer het zo meteen opnieuw.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } })
  try {
    const b = await berekenVrijeSlots(createAdminSupabaseClient())
    return NextResponse.json({
      dagen: perDag(b.slots), duurMinuten: KB_DUUR_MIN, tijdzone: 'Europe/Brussels',
      regels: { minVooraf: KB_MIN_VOORAF_TEKST, venster: `${KB_VENSTER.van}–${KB_VENSTER.tot}` },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    if (e instanceof BoekingFout) {
      if (e.intern) console.error('[boeken:beschikbaarheid]', e.intern)
      return NextResponse.json({ error: e.publiek }, { status: e.status })
    }
    console.error('[boeken:beschikbaarheid]', e)
    return NextResponse.json({ error: 'Online boeken is even niet mogelijk. Probeer het later opnieuw.' }, { status: 503 })
  }
}
