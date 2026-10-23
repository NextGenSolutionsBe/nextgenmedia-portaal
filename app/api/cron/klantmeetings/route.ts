import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { DATABANK_TIJDELIJK } from '@/lib/supabase/herkansing'
import { verwerkHerinneringen } from '@/lib/meetings/server'
import { cronToegang } from '@/lib/meetings/cron-toegang'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Herinneringsmails van meetings, elke vijf minuten.
 *
 * Aangeroepen door pg_cron (job 'klantmeetings-herinneringen') met het geheim
 * uit cron_geheimen ('klantmeetings'); de Vercel-CRON_SECRET werkt als reserve.
 * Zonder geldig geheim gebeurt er niets.
 */
export async function POST(req: NextRequest) {
  const toegang = await cronToegang(req)
  if (toegang === 'onbereikbaar') {
    return NextResponse.json({ error: DATABANK_TIJDELIJK }, { status: 503, headers: { 'Retry-After': '30' } })
  }
  if (toegang === 'nee') return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  try {
    const telling = await verwerkHerinneringen(createAdminSupabaseClient())
    return NextResponse.json({ ok: true, ...telling })
  } catch (e) {
    console.error('[cron:klantmeetings]', e)
    return NextResponse.json({ ok: false, error: 'Herinneringen niet verwerkt' }, { status: 500 })
  }
}

export const GET = POST
