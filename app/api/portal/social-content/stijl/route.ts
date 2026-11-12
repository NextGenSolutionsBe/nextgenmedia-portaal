import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { safeMessage } from '@/lib/api-error'
import { logPortalAction } from '@/lib/portal-auth'
import { kalenderPoort, geenRecht } from '@/lib/content/kalender-beheer-server'
import { magPersonaliseren } from '@/lib/content/kalender-rol'
import { StijlFout, leesKalenderStijl, stijlActie } from '@/lib/content/kalender-stijl-server'

export const dynamic = 'force-dynamic'

/**
 * De klant personaliseert zijn eigen contentkalender: eigen labels (enkel voor
 * deze kalender), labels op posts en een kleur per fase. Altijd op de
 * geresolveerde clientId; beheren enkel voor wie items mag aanmaken of aanpassen.
 *  · GET  → labels en fasekleuren
 *  · POST { actie: label_maak | label_wijzig | label_verwijder | kleuren | item_labels, … }
 */
export async function GET() {
  try {
    const p = await kalenderPoort(); if (p.fout) return p.fout
    return NextResponse.json({ stijl: await leesKalenderStijl(p.admin, p.session.clientId) })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const p = await kalenderPoort(); if (p.fout) return p.fout
    const { session, admin, door, rechten } = p
    if (!magPersonaliseren(rechten)) return geenRecht('Je kan de kalender niet aanpassen. Vraag het aan NextGenMedia.')
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const uit = await stijlActie(admin, session.clientId, b, door)
    await logPortalAction(session, `portal.content.${String(b.actie)}`, { type: 'content_kalender', id: typeof b.item === 'string' ? b.item : session.clientId }, { req, meta: { actie: b.actie, naam: b.naam ?? null } })
    try { revalidatePath('/portal/social-media'); revalidatePath('/admin/services/social-media') } catch { }
    return NextResponse.json({ ok: true, ...uit })
  } catch (err) {
    if (err instanceof StijlFout) return NextResponse.json({ error: err.message }, { status: err.status })
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
