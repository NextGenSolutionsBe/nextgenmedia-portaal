import { NextRequest, NextResponse } from 'next/server'
import { sendMetricoolDailyDigest, brusselsDateHour } from '@/lib/metricool-digest'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Dagelijkse INTERNE Metricool-samenvatting (nooit naar klanten).
// Beveiligd met CRON_SECRET (Vercel Cron stuurt Authorization: Bearer <secret>).
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  return req.nextUrl.searchParams.get('key') === secret
}

// Twee UTC-crons (06:00 + 07:00) dekken zomer- én wintertijd; deze route verstuurt
// enkel wanneer het in Brussel écht 08:00 is → de andere firing is een no-op.
// ?force=1 omzeilt de uur-check (voor handmatig testen).
export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  const force = req.nextUrl.searchParams.get('force') === '1'
  const { hour } = brusselsDateHour()
  if (!force && hour !== 8) {
    return NextResponse.json({ ok: true, skipped: true, reason: `niet 08:00 in Brussel (nu ${hour}u)` })
  }
  const res = await sendMetricoolDailyDigest()
  return NextResponse.json(res)
}
