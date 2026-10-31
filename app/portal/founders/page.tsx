export const dynamic = 'force-dynamic'

import { requirePortalView, sessionCan } from '@/lib/portal-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { KANAAL_SLEUTEL, type FoundersVideo } from '@/lib/founders-of-flanders'
import { FoundersShowcase } from '@/components/portal/founders/founders-showcase'

/**
 * Klantapp — Founders of Flanders: voorbeeldvideo's als inspiratie en de knop
 * om zelf een founder video aan te vragen. De aanvraag loopt via Aanvragen
 * (soort "founders"): offerte en planning volgen, het is nooit een boeking.
 */
export default async function PortalFoundersPage() {
  const session = await requirePortalView('founders')
  const admin = createAdminSupabaseClient()
  // Enkel de video's die het team hier zelf toevoegde; nieuwsbrieven staan op /portal/nieuws.
  const [{ data }, { data: k }] = await Promise.all([
    admin.from('founders_videos').select('*').eq('zichtbaar', true).order('volgorde').order('created_at'),
    admin.from('app_settings').select('value').eq('key', KANAAL_SLEUTEL).maybeSingle(),
  ])
  return <FoundersShowcase videos={(data ?? []) as FoundersVideo[]} magAanvragen={sessionCan(session, 'founders', 'aanvragen')} kanaal={typeof k?.value === 'string' ? k.value : null} />
}
