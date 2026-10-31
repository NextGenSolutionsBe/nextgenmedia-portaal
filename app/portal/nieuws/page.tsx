export const dynamic = 'force-dynamic'

import { requirePortalView } from '@/lib/portal-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import type { Nieuwsbrief } from '@/lib/nieuwsbrieven'
import { metExtra } from '@/lib/nieuwsbrieven-server'
import { NieuwsFeed } from '@/components/nieuws/nieuws-feed'

/** Klantapp — Nieuws: afgeronde projecten, klant in de kijker, tips en marketingnieuws. */
export default async function PortalNieuwsPage() {
  await requirePortalView('nieuws')
  const { data } = await createAdminSupabaseClient().from('nieuwsbrieven')
    .select('id, titel, slug, categorie, samenvatting, cover_pad, cover_youtube_id, blokken, uitgelicht, gepubliceerd_op, auteur_naam')
    .eq('status', 'gepubliceerd').order('gepubliceerd_op', { ascending: false }).limit(12)
  const items = ((data ?? []) as Nieuwsbrief[]).map((n) => { const { blokken: _b, ...rest } = metExtra(n); void _b; return rest })
  return <NieuwsFeed begin={items} meer={items.length === 12} />
}
