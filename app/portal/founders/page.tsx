export const dynamic = 'force-dynamic'

import { requirePortalView, sessionCan } from '@/lib/portal-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import type { FoundersVideo } from '@/lib/founders-of-flanders'
import { FoundersShowcase } from '@/components/portal/founders/founders-showcase'

/**
 * Klantapp — Founders of Flanders: voorbeeldvideo's als inspiratie en de knop
 * om zelf een founder video aan te vragen. De aanvraag loopt via Aanvragen
 * (soort "founders"): offerte en planning volgen, het is nooit een boeking.
 */
export default async function PortalFoundersPage() {
  const session = await requirePortalView('founders')
  const { data } = await createAdminSupabaseClient().from('founders_videos').select('*').eq('zichtbaar', true).order('volgorde').order('created_at')
  return <FoundersShowcase videos={(data ?? []) as FoundersVideo[]} magAanvragen={sessionCan(session, 'founders', 'aanvragen')} />
}
