import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, audit } from '@/lib/personeel/server'
import { wijzigBeschikbaarheid, verwijderBeschikbaarheid } from '@/lib/personeel/beschikbaarheid-server'
import { isUuid } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/**
 * Een admin past de beschikbaarheid van een medewerker aan (algemene kalender).
 * Beschikbaarheid hoeft niet meer goedgekeurd te worden: inboeken gebeurt
 * rechtstreeks in de kalender (POST /api/admin/personeel/planning).
 */

/** PATCH { start, eind } — de uren aanpassen. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    const b = (await req.json().catch(() => ({}))) as { start?: string; eind?: string }
    const r = await wijzigBeschikbaarheid(g.admin, { id, start: String(b.start ?? ''), eind: String(b.eind ?? '') })
    if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
    const { data: a } = await g.admin.from('personeel_beschikbaarheid').select('personeel_id').eq('id', id).maybeSingle()
    await audit(g.admin, { personeel_id: (a as { personeel_id?: string } | null)?.personeel_id ?? null, entiteit: 'beschikbaarheid', entiteit_id: id, actie: 'beschikbaarheid_gewijzigd', nieuw: { start: b.start, eind: b.eind }, actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** DELETE [?forceer=1] — verwijderen; waar al ingeboekt is eerst 409 { ingeboekt: true }, met forceer toch (werkblok blijft). */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    const { data: a } = await g.admin.from('personeel_beschikbaarheid').select('personeel_id').eq('id', id).maybeSingle()
    const r = await verwijderBeschikbaarheid(g.admin, { id, forceer: req.nextUrl.searchParams.get('forceer') === '1' })
    if (!r.ok) return NextResponse.json({ error: r.fout, ingeboekt: r.ingeboekt ?? false }, { status: r.status })
    await audit(g.admin, { personeel_id: (a as { personeel_id?: string } | null)?.personeel_id ?? null, entiteit: 'beschikbaarheid', entiteit_id: id, actie: 'beschikbaarheid_ingetrokken', actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
