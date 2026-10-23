import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { DATABANK_TIJDELIJK } from '@/lib/supabase/herkansing'
import { controleerKoppelingen, testAfspraak } from '@/lib/meetings/server'
import { cronToegang } from '@/lib/meetings/cron-toegang'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Controle van de koppelingen achter de meetingplanner, met hetzelfde geheim
 * als de scheduler. Leest enkel; met ?schrijftest=1 maakt hij daarbovenop een
 * afspraak ZONDER genodigden met Meet-link aan en verwijdert hem meteen stil.
 * Er wordt niemand uitgenodigd of gemaild, en er komt nooit een token in het antwoord.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const toegang = await cronToegang(req)
  if (toegang === 'onbereikbaar') return NextResponse.json({ error: DATABANK_TIJDELIJK }, { status: 503 })
  if (toegang === 'nee') return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  try {
    const admin = createAdminSupabaseClient()
    let agenda = req.nextUrl.searchParams.get('agenda')
    if (!agenda || !UUID.test(agenda)) {
      const { data } = await admin.from('sales_pipelines').select('default_calendar_id').eq('key', 'nextgenmedia').maybeSingle()
      agenda = (data?.default_calendar_id as string | null) ?? null
    }
    const checks = await controleerKoppelingen(admin, agenda)
    const schrijftest = req.nextUrl.searchParams.get('schrijftest') === '1' && agenda ? await testAfspraak(agenda) : null
    return NextResponse.json({ agenda, checks, schrijftest })
  } catch (e) {
    console.error('[cron:klantmeetings:diagnose]', e)
    return NextResponse.json({ error: 'Controle mislukt' }, { status: 500 })
  }
}

export const GET = POST
