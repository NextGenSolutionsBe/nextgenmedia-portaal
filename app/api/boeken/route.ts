import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { clientIp, rateLimit } from '@/lib/rate-limit'
import { logAudit, requestMeta } from '@/lib/audit'
import { boekKlantmeeting, BoekingFout } from '@/lib/meetings/klantboeking-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** Publiek: een klant boekt een gratis meeting. Alle regels worden hier opnieuw gecontroleerd. */
export async function POST(req: NextRequest) {
  const ip = clientIp(req)
  const rl = await rateLimit(`kb:boeken:${ip}`, { limit: 8, windowSec: 3600 })
  if (!rl.allowed) return NextResponse.json({ error: 'Te veel boekingen vanaf dit adres. Probeer het later opnieuw.' }, { status: 429 })
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  // Honingpot: een verborgen veld dat enkel bots invullen.
  if (String(b.website ?? '').trim()) return NextResponse.json({ error: 'Boeken mislukt.' }, { status: 400 })
  try {
    const r = await boekKlantmeeting(createAdminSupabaseClient(), b)
    if (!r.herhaald) {
      const { userAgent } = requestMeta(req)
      await logAudit({ action: 'klantboeking.geboekt', entityType: 'klant_meeting', entityId: r.id, actorEmail: 'klantboeking', summary: `Klantboeking op ${r.startsAt}`, ip, userAgent, metadata: { bevestiging: r.bevestigingVerstuurd } })
    }
    return NextResponse.json(r)
  } catch (e) {
    if (e instanceof BoekingFout) {
      if (e.intern) console.error('[boeken]', e.intern)
      return NextResponse.json({ error: e.publiek }, { status: e.status })
    }
    console.error('[boeken]', e)
    return NextResponse.json({ error: 'Boeken lukt nu niet. Probeer het later opnieuw.' }, { status: 500 })
  }
}
