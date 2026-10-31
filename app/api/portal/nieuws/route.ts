import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission } from '@/lib/portal-auth'
import { CATEGORIEEN, type Nieuwsbrief } from '@/lib/nieuwsbrieven'
import { metExtra } from '@/lib/nieuwsbrieven-server'

export const dynamic = 'force-dynamic'

/**
 * Feed van gepubliceerde nieuwsbrieven, per 12, nieuwste eerst.
 * ?categorie=…&voor=<gepubliceerd_op van het laatste item> voor de volgende reeks.
 * Enkel wat in de feed nodig is (geen blokken).
 */
export async function GET(req: NextRequest) {
  const g = await requirePortalPermission('nieuws', 'view')
  if (!g.ok) return g.response
  const sp = req.nextUrl.searchParams
  let q = createAdminSupabaseClient().from('nieuwsbrieven')
    .select('id, titel, slug, categorie, samenvatting, cover_pad, cover_youtube_id, blokken, uitgelicht, gepubliceerd_op, auteur_naam')
    .eq('status', 'gepubliceerd').order('gepubliceerd_op', { ascending: false }).limit(12)
  const cat = sp.get('categorie')
  if (cat && CATEGORIEEN.some((c) => c.key === cat)) q = q.eq('categorie', cat)
  const voor = sp.get('voor')
  if (voor && !Number.isNaN(Date.parse(voor))) q = q.lt('gepubliceerd_op', voor)
  const { data, error } = await q
  if (error) return NextResponse.json({ error: 'Laden mislukt' }, { status: 500 })
  const items = ((data ?? []) as Nieuwsbrief[]).map((n) => { const { blokken: _b, ...rest } = metExtra(n); void _b; return rest })
  return NextResponse.json({ items, meer: items.length === 12 }, { headers: { 'Cache-Control': 'no-store' } })
}
