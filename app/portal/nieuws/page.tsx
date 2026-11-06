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
    .select('id, titel, slug, categorie, categorie_label, samenvatting, cover_pad, cover_youtube_id, cover_formaat, cover_embed, blokken, uitgelicht, gepubliceerd_op, auteur_naam')
    .eq('status', 'gepubliceerd').order('gepubliceerd_op', { ascending: false }).limit(12)
  const items = ((data ?? []) as Nieuwsbrief[]).map((n) => { const { blokken: _b, ...rest } = metExtra(n); void _b; return rest })
  // Eigen categorieën (getypt in de editor) worden extra filters.
  const { data: eigenRijen } = await createAdminSupabaseClient().from('nieuwsbrieven').select('categorie_label').eq('status', 'gepubliceerd').eq('categorie', 'andere').limit(500)
  const eigen = [...new Set(((eigenRijen ?? []) as { categorie_label: string | null }[]).map((r) => r.categorie_label?.trim()).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b, 'nl'))
  return <NieuwsFeed begin={items} meer={items.length === 12} eigen={eigen} />
}
