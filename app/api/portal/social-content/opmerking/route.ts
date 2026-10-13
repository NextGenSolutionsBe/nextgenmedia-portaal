import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { logPortalAction } from '@/lib/portal-auth'
import { opmerkingTekst } from '@/lib/content/kalender-rol'
import { kalenderPoort, geenRecht, plaatsOpmerking, leesContentActiviteit } from '@/lib/content/kalender-beheer-server'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

/**
 * POST {id, tekst} — opmerking bij een eigen contentitem (Feedback geven,
 * Meewerken, Beheren). Verandert niets aan de inhoud of de status; NextGenMedia
 * ziet de opmerking bij het item en als signaal in de bel.
 */
export async function POST(req: NextRequest) {
  try {
    const p = await kalenderPoort(); if (p.fout) return p.fout
    const { session, admin, rechten, door } = p
    if (!rechten.opmerkingen) return geenRecht('Je kan geen opmerkingen plaatsen in de kalender.')
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    let tekst
    try { tekst = opmerkingTekst(body.tekst) } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'Ongeldige opmerking.' }, { status: 400 }) }
    const id = String(body.id ?? '')
    const { data: item } = await admin.from('social_content_items').select('id').eq('id', id).eq('client_id', session.clientId).maybeSingle()
    if (!item) return NextResponse.json({ error: 'Item niet gevonden.' }, { status: 404 })
    await plaatsOpmerking(admin, { item_id: item.id, client_id: session.clientId, door, rol: 'klant', tekst })
    await logPortalAction(session, 'portal.content.opmerking', { type: 'social_content_item', id: item.id }, { req, meta: { lengte: tekst.length } })
    try { revalidatePath('/admin/services/social-media') } catch { }
    return NextResponse.json({ ok: true, activiteit: await leesContentActiviteit(admin, item.id) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
