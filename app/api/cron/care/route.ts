import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { cronToegang } from '@/lib/meetings/cron-toegang'
import { monitorRonde } from '@/lib/ngs/care-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Monitoring van Care (nieuwe werking fase 6): elke 10 minuten via pg_cron
 * (`care-monitoring`). Enkel pakketten met monitoring en een publieke https-link.
 * Twee mislukte checks na elkaar = alarm in het belletje; nooit een mail naar de klant.
 */
export async function POST(req: NextRequest) {
  const toegang = await cronToegang(req)
  if (toegang === 'onbereikbaar') return NextResponse.json({ error: 'Databank even niet bereikbaar' }, { status: 503 })
  if (toegang !== 'ja') return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  const r = await monitorRonde(createAdminSupabaseClient())
  return NextResponse.json({ ok: true, ...r })
}
