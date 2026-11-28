import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { draaiClickupAgendaSync } from '@/lib/sales/clickup-agenda-sync'
import { metHerkansing, DATABANK_TIJDELIJK } from '@/lib/supabase/herkansing'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * ClickUp → Google Calendar, elke tien minuten.
 *
 * Aangeroepen door pg_cron in de databank (Vercel Hobby kan geen crons per
 * tien minuten). Het geheim staat in de tabel cron_geheimen — alleen de
 * databank en deze route kennen het; er hoeft geen extra env var gezet te
 * worden. De Vercel-CRON_SECRET wordt óók aanvaard, zodat een Vercel-cron
 * als reserve kan dienen.
 */
/**
 * Drie uitkomsten, niet twee. "Het geheim kon niet gelezen worden" is iets
 * anders dan "het geheim klopt niet": in het eerste geval hapert de databank
 * even en hoort het antwoord een 503 te zijn, geen 401. Voorheen viel een
 * mislukte lezing stil terug op CRON_SECRET (die pg_cron niet meestuurt) en
 * werd élke hapering een "Niet geautoriseerd" — tientallen per dag.
 */
async function geautoriseerd(req: NextRequest): Promise<'ja' | 'nee' | 'onbereikbaar'> {
  const meegegeven = req.headers.get('x-sync-secret') ?? req.nextUrl.searchParams.get('key') ?? ''
  let onbereikbaar = false
  if (meegegeven) {
    try {
      const admin = createAdminSupabaseClient()
      const { data, error } = await metHerkansing<{ waarde: string }>(() =>
        admin.from('cron_geheimen').select('waarde').eq('sleutel', 'clickup_agenda').maybeSingle())
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
  const r = await draaiClickupAgendaSync()
  return NextResponse.json(r, { status: r.ok ? 200 : 500 })
}

// pg_net kan ook met GET uit de voeten; zelfde werk, zelfde slot.
export const GET = POST
