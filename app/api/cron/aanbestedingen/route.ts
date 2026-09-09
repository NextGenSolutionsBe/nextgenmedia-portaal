import { NextRequest, NextResponse } from 'next/server'
import { automatischeRonde } from '@/lib/aanbestedingen/auto'

export const dynamic = 'force-dynamic'
export const maxDuration = 300

/**
 * De automatische ronde voor Aanbestedingen: ophalen, beoordelen, uitwerken en
 * mailen.
 *
 * Vercel staat op dit plan enkel dagelijkse schema's toe, dus staan er twee
 * vaste momenten in vercel.json (ochtend en namiddag). Welke workspace dan
 * effectief draait, bepaalt zijn eigen instelling: de gekozen dagen, het uur
 * vanaf wanneer, en hoogstens één keer per dag.
 *
 * Beveiligd met CRON_SECRET, net als de andere crons.
 */
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  return req.nextUrl.searchParams.get('key') === secret
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  const res = await automatischeRonde()
  return NextResponse.json({ ok: true, ...res })
}
