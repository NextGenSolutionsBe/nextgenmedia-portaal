import 'server-only'
import type { NextRequest } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { metHerkansing } from '@/lib/supabase/herkansing'

/**
 * Autorisatie voor de community-sync, zelfde patroon als /api/cron/clickup-agenda:
 * het geheim staat in cron_geheimen (sleutel 'community_sync'), pg_cron stuurt het
 * mee als header x-sync-secret. CRON_SECRET (Vercel) wordt ook aanvaard als reserve.
 *
 * Drie uitkomsten, niet twee: "het geheim kon niet gelezen worden" (databank
 * hapert → 503) is iets anders dan "het geheim klopt niet" (→ 401).
 */
export const COMMUNITY_CRON_SLEUTEL = 'community_sync'

export async function cronGeautoriseerd(req: NextRequest, sleutel = COMMUNITY_CRON_SLEUTEL): Promise<'ja' | 'nee' | 'onbereikbaar'> {
  const meegegeven = req.headers.get('x-sync-secret') ?? ''
  let onbereikbaar = false
  if (meegegeven) {
    try {
      const admin = createAdminSupabaseClient()
      const { data, error } = await metHerkansing<{ waarde: string }>(() =>
        admin.from('cron_geheimen').select('waarde').eq('sleutel', sleutel).maybeSingle())
      if (error && !/does not exist|schema cache/i.test(error.message)) onbereikbaar = true
      const echt = data?.waarde
      if (echt && meegegeven === echt) return 'ja'
    } catch { onbereikbaar = true }
  }
  const cronSecret = process.env.CRON_SECRET
  if (!!cronSecret && req.headers.get('authorization') === `Bearer ${cronSecret}`) return 'ja'
  return onbereikbaar ? 'onbereikbaar' : 'nee'
}
