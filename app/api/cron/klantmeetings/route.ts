import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { metHerkansing, DATABANK_TIJDELIJK } from '@/lib/supabase/herkansing'
import { verwerkHerinneringen } from '@/lib/meetings/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Herinneringsmails van klantmeetings, elke vijf minuten.
 *
 * Aangeroepen door pg_cron (job 'klantmeetings-herinneringen') met het geheim
 * uit cron_geheimen ('klantmeetings'); de Vercel-CRON_SECRET werkt als reserve.
 * Zonder geldig geheim gebeurt er niets. Zelfde opzet als /api/cron/clickup-agenda.
 */
async function geautoriseerd(req: NextRequest): Promise<'ja' | 'nee' | 'onbereikbaar'> {
  const meegegeven = req.headers.get('x-sync-secret') ?? ''
  let onbereikbaar = false
  if (meegegeven) {
    try {
      const admin = createAdminSupabaseClient()
      const { data, error } = await metHerkansing<{ waarde: string }>(() =>
        admin.from('cron_geheimen').select('waarde').eq('sleutel', 'klantmeetings').maybeSingle())
      if (error && !/does not exist|schema cache/i.test(error.message)) onbereikbaar = true
      const echt = data?.waarde
      if (echt && meegegeven === echt) return 'ja'
    } catch { onbereikbaar = true }
  }
  const cronSecret = process.env.CRON_SECRET
  if (!!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) return 'ja'
  return onbereikbaar ? 'onbereikbaar' : 'nee'
}

export async function POST(req: NextRequest) {
  const toegang = await geautoriseerd(req)
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
