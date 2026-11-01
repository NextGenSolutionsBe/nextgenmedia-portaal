export const dynamic = 'force-dynamic'

import { requirePortalView, sessionCan } from '@/lib/portal-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { KANAAL_SLEUTEL, naarFoundersVideo } from '@/lib/founders-of-flanders'
import { FoundersShowcase } from '@/components/portal/founders/founders-showcase'
import { waitUntil } from '@vercel/functions'
import { kopieerInstagramMedia, ontbrekendeMedia } from '@/lib/founders-media-server'

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
  // Een Instagram-video die nog niet in de eigen opslag staat: op de achtergrond ophalen (volgende keer speelt ze in de app).
  const teHalen = ontbrekendeMedia((data ?? []) as Record<string, unknown>[])
  if (teHalen.length) waitUntil(Promise.all(teHalen.map((id) => kopieerInstagramMedia(admin, id).catch(() => null))))
  return <FoundersShowcase videos={((data ?? []) as Record<string, unknown>[]).map(naarFoundersVideo).filter((v) => v.youtube_id || v.embed)} magAanvragen={sessionCan(session, 'founders', 'aanvragen')} kanaal={typeof k?.value === 'string' ? k.value : null} />
}
