import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission } from '@/lib/portal-auth'
import { safeMessage } from '@/lib/api-error'
import { aanvraagVanKlant, bestandVanAanvraag, tijdelijkeLink, AanvraagFout } from '@/lib/aanvragen/server'
import { moduleVoor, soortUit } from '@/lib/aanvragen/portaal'

export const dynamic = 'force-dynamic'

/**
 * Een bestand of de offerte van een eigen aanvraag openen: doorsturen naar
 * een tijdelijke link (5 minuten). ?soort=…&bestand=<id> of ?soort=…&offerte=1
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const soort = soortUit(req.nextUrl.searchParams.get('soort'))
  if (!soort) return NextResponse.json({ error: 'Onbekend soort aanvraag' }, { status: 400 })
  const g = await requirePortalPermission(moduleVoor(soort), 'view')
  if (!g.ok) return g.response
  try {
    const admin = createAdminSupabaseClient()
    const a = await aanvraagVanKlant(admin, g.session.clientId, id)
    if (!a || a.soort !== soort) return NextResponse.json({ error: 'Aanvraag niet gevonden.' }, { status: 404 })
    if (req.nextUrl.searchParams.get('offerte') === '1') {
      if (!a.offerte_status) return NextResponse.json({ error: 'Er is geen offerte.' }, { status: 404 })
      if (a.offerte_pad) return NextResponse.redirect(await tijdelijkeLink(admin, a.offerte_pad))
      if (a.offerte_url) return NextResponse.redirect(a.offerte_url)
      return NextResponse.json({ error: 'Er is geen offerte.' }, { status: 404 })
    }
    const bestand = await bestandVanAanvraag(admin, a.id, String(req.nextUrl.searchParams.get('bestand') ?? ''))
    if (!bestand) return NextResponse.json({ error: 'Bestand niet gevonden.' }, { status: 404 })
    return NextResponse.redirect(await tijdelijkeLink(admin, bestand.pad))
  } catch (e) {
    if (e instanceof AanvraagFout) return NextResponse.json({ error: e.publiek }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'portal-aanvragen.bestand') }, { status: 500 })
  }
}
