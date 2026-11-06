export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requirePortalView } from '@/lib/portal-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import type { Nieuwsbrief } from '@/lib/nieuwsbrieven'
import { metExtra } from '@/lib/nieuwsbrieven-server'
import { ArtikelPagina } from '@/components/nieuws/artikel-pagina'

/** Klantapp — één nieuwsbrief, met daarna het volgende verhaal en "Lees ook". */
export default async function PortalNieuwsArtikel({ params }: { params: Promise<{ slug: string }> }) {
  await requirePortalView('nieuws')
  const { slug } = await params
  const admin = createAdminSupabaseClient()
  const { data } = await admin.from('nieuwsbrieven').select('*').eq('slug', slug).eq('status', 'gepubliceerd').maybeSingle()
  if (!data) notFound()
  const n = metExtra(data as Nieuwsbrief)
  // Verder lezen: eerst dezelfde categorie, dan het nieuwste.
  const velden = 'id, titel, slug, categorie, categorie_label, samenvatting, cover_pad, cover_youtube_id, cover_formaat, cover_embed, blokken, uitgelicht, gepubliceerd_op, auteur_naam'
  const [{ data: zelfde }, { data: nieuwst }] = await Promise.all([
    admin.from('nieuwsbrieven').select(velden).eq('status', 'gepubliceerd').eq('categorie', n.categorie).neq('id', n.id).order('gepubliceerd_op', { ascending: false }).limit(3),
    admin.from('nieuwsbrieven').select(velden).eq('status', 'gepubliceerd').neq('id', n.id).order('gepubliceerd_op', { ascending: false }).limit(6),
  ])
  const gezien = new Set<string>()
  const verder = [...(zelfde ?? []), ...(nieuwst ?? [])].filter((x) => !gezien.has(x.id) && gezien.add(x.id)).slice(0, 4)
    .map((x) => { const { blokken: _b, ...rest } = metExtra(x as Nieuwsbrief); void _b; return rest })
  return <ArtikelPagina n={n} verder={verder} />
}
