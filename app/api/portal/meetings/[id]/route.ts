import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'
import {
  klantappMeeting, klantappWeergave, annuleerViaLink, verplaatsKlantboeking, BoekingFout,
} from '@/lib/meetings/klantboeking-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Klantapp — een eigen boeking verplaatsen of annuleren.
 *  PATCH { actie: 'verplaats', start } | { actie: 'annuleer' }
 * Enkel boekingen van de klant van de ingelogde gebruiker; verplaatsen volgt
 * de klantregels (72 uur, 11:00–17:00, vrij in ClickUp en Google).
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requirePortalPermission('meetings', 'book')
  if (!g.ok) return g.response
  const admin = createAdminSupabaseClient()
  const m = await klantappMeeting(admin, g.session.clientId, params.id)
  if (!m) return NextResponse.json({ error: 'Meeting niet gevonden.' }, { status: 404 })
  const b = await req.json().catch(() => ({})) as { actie?: string; start?: unknown }
  try {
    if (b.actie === 'annuleer') {
      const x = await annuleerViaLink(admin, m, new Date(), `klantapp (${g.session.email ?? 'klant'})`)
      await logPortalAction(g.session, 'meeting.geannuleerd', { type: 'klant_meeting', id: m.id }, { req })
      return NextResponse.json({ meeting: klantappWeergave(x) })
    }
    if (b.actie === 'verplaats') {
      const x = await verplaatsKlantboeking(admin, m, { soort: 'klantapp' }, b.start)
      await logPortalAction(g.session, 'meeting.verplaatst', { type: 'klant_meeting', id: m.id }, { req, meta: { naar: x.starts_at } })
      return NextResponse.json({ meeting: klantappWeergave(x) })
    }
    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (e) {
    if (e instanceof BoekingFout) {
      if (e.intern) console.error('[portal:meetings:beheer]', e.intern)
      return NextResponse.json({ error: e.publiek }, { status: e.status })
    }
    console.error('[portal:meetings:beheer]', e)
    return NextResponse.json({ error: 'Er ging iets mis. Probeer het later opnieuw of mail ons op info@nextgenmedia.be.' }, { status: 500 })
  }
}
