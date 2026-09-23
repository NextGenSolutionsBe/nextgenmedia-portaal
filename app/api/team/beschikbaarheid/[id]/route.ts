import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisTeamLid, audit, meld } from '@/lib/personeel/server'
import { magIntrekken } from '@/lib/personeel/planning'
import { isUuid } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/** DELETE — een beschikbaarheid intrekken, zolang ze nog niet behandeld is. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const { data: a } = await g.admin.from('personeel_beschikbaarheid').select('*').eq('id', id).eq('personeel_id', g.lid.id).maybeSingle()
    if (!a) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
    if (!magIntrekken(a.status)) return NextResponse.json({ error: 'Deze beschikbaarheid is al behandeld; vraag je verantwoordelijke om een wijziging.' }, { status: 409 })
    await g.admin.from('personeel_beschikbaarheid').update({ status: 'ingetrokken', updated_at: new Date().toISOString() }).eq('id', id)
    await audit(g.admin, { personeel_id: g.lid.id, entiteit: 'beschikbaarheid', entiteit_id: id, actie: 'beschikbaarheid_ingetrokken', oud: { status: a.status }, nieuw: { status: 'ingetrokken' }, actor_email: g.lid.email, actor_id: g.lid.auth_user_id })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** POST { actie: 'voorstel_aanvaarden' } — het voorstel van een admin (ander begin/einde) aanvaarden. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const b = (await req.json().catch(() => ({}))) as { actie?: string }
    if (b.actie !== 'voorstel_aanvaarden') return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    const { data: a } = await g.admin.from('personeel_beschikbaarheid').select('*').eq('id', id).eq('personeel_id', g.lid.id).maybeSingle()
    if (!a) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
    if (a.status !== 'ingediend' || !a.voorstel_start || !a.voorstel_eind) return NextResponse.json({ error: 'Er staat geen open voorstel.' }, { status: 409 })
    await g.admin.from('personeel_beschikbaarheid').update({ start_tijd: a.voorstel_start, eind_tijd: a.voorstel_eind, voorstel_start: null, voorstel_eind: null, updated_at: new Date().toISOString() }).eq('id', id)
    await audit(g.admin, { personeel_id: g.lid.id, entiteit: 'beschikbaarheid', entiteit_id: id, actie: 'voorstel_aanvaard', oud: { start: a.start_tijd, eind: a.eind_tijd }, nieuw: { start: a.voorstel_start, eind: a.voorstel_eind }, actor_email: g.lid.email, actor_id: g.lid.auth_user_id })
    const naam = [g.lid.voornaam, g.lid.achternaam].filter(Boolean).join(' ')
    await meld(g.admin, { personeel_id: null, event: 'beschikbaarheid_ingediend', titel: `Voorstel aanvaard — ${naam}`, tekst: `${naam} aanvaardde ${String(a.voorstel_start).slice(0, 5)}–${String(a.voorstel_eind).slice(0, 5)} op ${String(a.datum).split('-').reverse().join('/')}. Keur het nu goed om in te plannen.`, link: '/admin/personeel?tab=planning' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
