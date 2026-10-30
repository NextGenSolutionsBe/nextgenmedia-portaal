import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'
import { safeMessage } from '@/lib/api-error'
import { aanvraagVanKlant, klantBeslistOfferte, klantTrektIn, AanvraagFout } from '@/lib/aanvragen/server'
import { moduleVoor, soortUit } from '@/lib/aanvragen/portaal'

export const dynamic = 'force-dynamic'

/**
 * Eén eigen aanvraag.
 *  PATCH { actie: 'offerte', besluit: 'aanvaard' | 'geweigerd', reden? } — de gekoppelde offerte beslissen
 *  PATCH { actie: 'intrekken' } — zolang wij nog niets beslisten
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const b = await req.json().catch(() => ({})) as { actie?: string; besluit?: unknown; reden?: unknown; soort?: unknown }
  const soort = soortUit(b.soort)
  if (!soort) return NextResponse.json({ error: 'Onbekend soort aanvraag' }, { status: 400 })
  const g = await requirePortalPermission(moduleVoor(soort), 'aanvragen')
  if (!g.ok) return g.response
  try {
    const admin = createAdminSupabaseClient()
    const a = await aanvraagVanKlant(admin, g.session.clientId, id)
    if (!a || a.soort !== soort) return NextResponse.json({ error: 'Aanvraag niet gevonden.' }, { status: 404 })
    const door = g.session.name || g.session.email || 'klant'
    if (b.actie === 'offerte') {
      const x = await klantBeslistOfferte(admin, a, b.besluit, b.reden, door)
      await logPortalAction(g.session, `aanvraag.offerte_${x.offerte_status}`, { type: 'klant_aanvraag', id: a.id }, { req })
      return NextResponse.json({ status: x.status, offerte_status: x.offerte_status })
    }
    if (b.actie === 'intrekken') {
      const x = await klantTrektIn(admin, a, door)
      await logPortalAction(g.session, 'aanvraag.ingetrokken', { type: 'klant_aanvraag', id: a.id }, { req })
      return NextResponse.json({ status: x.status })
    }
    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (e) {
    if (e instanceof AanvraagFout) return NextResponse.json({ error: e.publiek }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'portal-aanvragen.PATCH') }, { status: 500 })
  }
}
