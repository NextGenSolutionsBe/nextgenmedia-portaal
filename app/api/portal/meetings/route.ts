import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, sessionCan, logPortalAction } from '@/lib/portal-auth'
import { rateLimit } from '@/lib/rate-limit'
import { KB_DUUR_MIN, KB_MIN_VOORAF_TEKST, KB_VENSTER } from '@/lib/meetings/klantboeking'
import { boekKlantmeeting, klantappMeetings, klantappMeeting, klantappWeergave, BoekingFout } from '@/lib/meetings/klantboeking-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/** De bedrijfsnaam uit het klantdossier: dat is wat in de agenda en bij ons verschijnt. */
async function bedrijfVan(clientId: string): Promise<string> {
  const { data } = await createAdminSupabaseClient().from('clients').select('company_name, contact_name').eq('id', clientId).maybeSingle()
  const c = data as { company_name: string | null; contact_name: string | null } | null
  return c?.company_name || c?.contact_name || 'Klant'
}

const fout = (e: unknown, plek: string) => {
  if (e instanceof BoekingFout) {
    if (e.intern) console.error(`[portal:meetings:${plek}]`, e.intern)
    return NextResponse.json({ error: e.publiek }, { status: e.status })
  }
  console.error(`[portal:meetings:${plek}]`, e)
  return NextResponse.json({ error: 'Er ging iets mis. Probeer het later opnieuw of mail ons op info@nextgenmedia.be.' }, { status: 500 })
}

/** Klantapp — Mijn meetings: enkel de boekingen van de eigen klant. */
export async function GET() {
  const g = await requirePortalPermission('meetings', 'view')
  if (!g.ok) return g.response
  try {
    const lijst = await klantappMeetings(createAdminSupabaseClient(), g.session.clientId)
    return NextResponse.json({
      meetings: lijst.map((m) => klantappWeergave(m)),
      profiel: { naam: g.session.name, email: g.session.email, bedrijf: await bedrijfVan(g.session.clientId) },
      magBoeken: sessionCan(g.session, 'meetings', 'book'),
      regels: { duurMinuten: KB_DUUR_MIN, minVooraf: KB_MIN_VOORAF_TEKST, venster: `${KB_VENSTER.van} en ${KB_VENSTER.tot}`, tijdzone: 'Europe/Brussels' },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return fout(e, 'lijst') }
}

/**
 * Klantapp — een gratis meeting boeken. Dezelfde motor als de publieke
 * boekingspagina: regels (72 uur, 11–17, 30 min), opnieuw controleren,
 * reserveren, Google + Meet, ClickUp, herinnering en bevestiging. De meeting
 * hangt aan de klant van de ingelogde gebruiker.
 */
export async function POST(req: NextRequest) {
  const g = await requirePortalPermission('meetings', 'book')
  if (!g.ok) return g.response
  const rl = await rateLimit(`kb:klantapp:${g.session.userId}`, { limit: 10, windowSec: 3600 })
  if (!rl.allowed) return NextResponse.json({ error: 'Even te veel aanvragen. Probeer het later opnieuw.' }, { status: 429 })
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  try {
    const admin = createAdminSupabaseClient()
    const bedrijf = await bedrijfVan(g.session.clientId)
    const r = await boekKlantmeeting(admin, {
      aanvraag_sleutel: b.aanvraag_sleutel, naam: b.naam, email: b.email, reden: b.onderwerp, start: b.start, bedrijf,
    }, new Date(), { clientId: g.session.clientId, bedrijf, doorEmail: g.session.email, extraDeelnemers: b.deelnemers })
    if (!r.herhaald) await logPortalAction(g.session, 'meeting.geboekt', { type: 'klant_meeting', id: r.id }, { req, meta: { starts_at: r.startsAt, bevestiging: r.bevestigingVerstuurd } })
    const m = await klantappMeeting(admin, g.session.clientId, r.id)
    return NextResponse.json({ ...r, meeting: m ? klantappWeergave(m) : null })
  } catch (e) { return fout(e, 'boeken') }
}
