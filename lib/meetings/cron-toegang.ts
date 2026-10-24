import 'server-only'
import type { NextRequest } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { metHerkansing } from '@/lib/supabase/herkansing'

/**
 * Toegang voor pg_cron: het geheim uit cron_geheimen ('klantmeetings') in de
 * header x-sync-secret, of de Vercel-CRON_SECRET als reserve. Drie uitkomsten:
 * "kon het geheim niet lezen" is een 503, geen 401 (zelfde opzet als
 * /api/cron/clickup-agenda).
 */
export async function cronToegang(req: NextRequest): Promise<'ja' | 'nee' | 'onbereikbaar'> {
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
