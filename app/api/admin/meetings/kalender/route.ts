import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { plannerRechten } from '@/lib/meetings/rechten'
import { kalenderData } from '@/lib/meetings/kalender-server'
import { veiligeFout } from '@/lib/meetings/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Calendar: GET ?van=<ms>&tot=<ms>&agenda=<id>&vrij=1|0
 * Meetings, verkoopafspraken, ClickUp-meetings en Google-afspraken van één
 * persoon, plus de vrije momenten (strikt berekend). Voor wie de Meeting
 * Inplanner of Verkoop mag zien; verkoopafspraken enkel in detail met Verkoop.
 */
export async function GET(req: NextRequest) {
  const r = await plannerRechten()
  if (!r.persoon || (!r.meetings.bekijken && !r.verkoop.bekijken)) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  const sp = req.nextUrl.searchParams
  const van = Number(sp.get('van')), tot = Number(sp.get('tot'))
  if (!Number.isFinite(van) || !Number.isFinite(tot) || tot <= van) return NextResponse.json({ error: 'van en tot zijn vereist' }, { status: 400 })
  // Een maand in beeld is 6 weken; meer hoeft één verzoek nooit op te halen.
  if (tot - van > 43 * 86400000) return NextResponse.json({ error: 'Venster te groot' }, { status: 400 })
  const agenda = sp.get('agenda')
  try {
    const d = await kalenderData(createAdminSupabaseClient(), {
      agendaId: agenda && UUID.test(agenda) ? agenda : null, van, tot,
      vrij: sp.get('vrij') !== '0', verkoopDetails: r.verkoop.bekijken,
    })
    return NextResponse.json(d)
  } catch (e) {
    console.error('[meetings:kalender]', e)
    return NextResponse.json({ error: `Calendar laden mislukt: ${veiligeFout(e)}` }, { status: 500 })
  }
}
