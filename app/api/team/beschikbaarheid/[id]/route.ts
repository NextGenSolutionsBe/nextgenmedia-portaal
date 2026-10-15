import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisTeamLid, audit, meld } from '@/lib/personeel/server'
import { wijzigBeschikbaarheid, verwijderBeschikbaarheid } from '@/lib/personeel/beschikbaarheid-server'
import { isUuid } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/** PATCH { start, eind } — de uren van je eigen beschikbaarheid aanpassen. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const b = (await req.json().catch(() => ({}))) as { start?: string; eind?: string }
    const r = await wijzigBeschikbaarheid(g.admin, { id, personeelId: g.lid.id, start: String(b.start ?? ''), eind: String(b.eind ?? '') })
    if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
    await audit(g.admin, { personeel_id: g.lid.id, entiteit: 'beschikbaarheid', entiteit_id: id, actie: 'beschikbaarheid_gewijzigd', nieuw: { start: b.start, eind: b.eind }, actor_email: g.lid.email, actor_id: g.lid.auth_user_id })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * DELETE [?forceer=1] — je eigen beschikbaarheid verwijderen. Ben je daar al
 * ingeboekt, dan eerst 409 { ingeboekt: true }; met forceer gaat het toch (het
 * werkblok blijft) en krijgt NextGenMedia een melding.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const r = await verwijderBeschikbaarheid(g.admin, { id, personeelId: g.lid.id, forceer: req.nextUrl.searchParams.get('forceer') === '1' })
    if (!r.ok) return NextResponse.json({ error: r.fout, ingeboekt: r.ingeboekt ?? false }, { status: r.status })
    await audit(g.admin, { personeel_id: g.lid.id, entiteit: 'beschikbaarheid', entiteit_id: id, actie: 'beschikbaarheid_ingetrokken', nieuw: r.ingeboekt ? { ingeboekt: r.ingeboekt } : undefined, actor_email: g.lid.email, actor_id: g.lid.auth_user_id })
    if (r.ingeboekt) {
      const naam = [g.lid.voornaam, g.lid.achternaam].filter(Boolean).join(' ')
      await meld(g.admin, { personeel_id: null, event: 'planning_bevestigd', titel: `${naam} is niet meer beschikbaar waar die ingeboekt is`, tekst: `Werkblok ${r.ingeboekt} blijft staan — kijk of het nog doorgaat.`, link: '/admin/personeel?tab=planning' })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
