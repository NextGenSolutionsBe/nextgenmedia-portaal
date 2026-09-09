import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { draaiClickupAgendaSync } from '@/lib/sales/clickup-agenda-sync'

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
async function geautoriseerd(req: NextRequest): Promise<boolean> {
  const meegegeven = req.headers.get('x-sync-secret') ?? req.nextUrl.searchParams.get('key') ?? ''
  if (meegegeven) {
    try {
      const admin = createAdminSupabaseClient()
      const { data } = await admin.from('cron_geheimen')
        .select('waarde').eq('sleutel', 'clickup_agenda').maybeSingle()
      const echt = (data as { waarde: string } | null)?.waarde
      if (echt && meegegeven === echt) return true
    } catch { /* tabel ontbreekt → alleen CRON_SECRET werkt */ }
  }
  const cronSecret = process.env.CRON_SECRET
  return !!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`
}

export async function POST(req: NextRequest) {
  if (!(await geautoriseerd(req))) return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  const r = await draaiClickupAgendaSync()
  return NextResponse.json(r, { status: r.ok ? 200 : 500 })
}

// pg_net kan ook met GET uit de voeten; zelfde werk, zelfde slot.
export const GET = POST
