import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

/**
 * Eenvoudige rate limiting op de bestaande database — geen extra dienst nodig.
 *
 * Werkt met een glijdend venster: we tellen hoeveel pogingen er in de afgelopen
 * `windowSec` seconden op dezelfde sleutel binnenkwamen. Sleutels zijn bewust
 * grof (IP + soort actie), zodat we nooit persoonsgegevens hoeven te bewaren.
 *
 * FAIL-OPEN: kan de teller niet gelezen/geschreven worden (tabel ontbreekt nog,
 * database traag), dan laten we het verzoek DOOR. Reden: dit is een extra
 * beschermlaag bovenop de echte guards; een storing in de teller mag nooit de
 * hele app op slot zetten. De authenticatie zelf blijft altijd verplicht.
 */

export type RateVerdict = { allowed: boolean; retryAfterSec: number; remaining: number }

/** IP uit de gebruikelijke proxy-headers (Vercel zet x-forwarded-for). */
export function clientIp(req: Request): string {
  const h = req.headers
  const fwd = h.get('x-forwarded-for') ?? ''
  const first = fwd.split(',')[0]?.trim()
  return first || h.get('x-real-ip') || 'onbekend'
}

export async function rateLimit(
  key: string,
  opts: { limit: number; windowSec: number },
): Promise<RateVerdict> {
  const ok: RateVerdict = { allowed: true, retryAfterSec: 0, remaining: opts.limit }
  try {
    const admin = createAdminSupabaseClient()
    const since = new Date(Date.now() - opts.windowSec * 1000).toISOString()

    const { count, error } = await admin
      .from('rate_limit_hits')
      .select('id', { count: 'exact', head: true })
      .eq('key', key)
      .gte('created_at', since)
    if (error) return ok   // fail-open, zie toelichting hierboven

    const used = count ?? 0
    if (used >= opts.limit) {
      return { allowed: false, retryAfterSec: opts.windowSec, remaining: 0 }
    }

    await admin.from('rate_limit_hits').insert({ key, created_at: new Date().toISOString() })
    return { allowed: true, retryAfterSec: 0, remaining: Math.max(0, opts.limit - used - 1) }
  } catch {
    return ok
  }
}

/** Oude tellers opruimen (aangeroepen vanuit een cron; houdt de tabel klein). */
export async function pruneRateLimits(olderThanSec = 24 * 3600): Promise<number> {
  try {
    const admin = createAdminSupabaseClient()
    const cutoff = new Date(Date.now() - olderThanSec * 1000).toISOString()
    const { data } = await admin.from('rate_limit_hits').delete().lt('created_at', cutoff).select('id')
    return data?.length ?? 0
  } catch {
    return 0
  }
}
