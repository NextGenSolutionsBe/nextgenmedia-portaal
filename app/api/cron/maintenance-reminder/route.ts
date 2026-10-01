import { NextRequest, NextResponse } from 'next/server'
import { runMaintenanceReminders } from '@/lib/maintenance-report'
import { pruneRateLimits } from '@/lib/rate-limit'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { verwerkVerstreken } from '@/lib/content/goedkeuring-deadlines'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Dagelijkse check: welke onderhoudspakketten lopen binnen een maand af?
// INTERN (alleen naar NextGenMedia). Beveiligd met CRON_SECRET — Vercel Cron
// stuurt Authorization: Bearer <secret>; handmatig testen kan met ?key=<secret>.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  if (req.headers.get('authorization') === `Bearer ${secret}`) return true
  return req.nextUrl.searchParams.get('key') === secret
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Niet geautoriseerd' }, { status: 401 })
  const res = await runMaintenanceReminders()
  // Meteen de oude rate-limit-tellers opruimen (>24u) zodat die tabel klein blijft.
  const pruned = await pruneRateLimits()
  // Verstreken goedkeuringsdeadlines van de contentkalender verwerken (wat nog
  // "bij klant" staat → goedgekeurd). Gebeurt ook zodra iemand het portaal of het
  // overzicht opent; dit is het dagelijkse vangnet.
  let contentAutoGoedgekeurd = 0
  try { contentAutoGoedgekeurd = await verwerkVerstreken(createAdminSupabaseClient()) } catch { /* volgende run */ }
  return NextResponse.json({ ok: true, ...res, rateLimitsPruned: pruned, contentAutoGoedgekeurd })
}
