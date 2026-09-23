import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisTeamLid, audit, meld } from '@/lib/personeel/server'
import { controleerSessie, overlaptMetSessies, dagBrussel, uurBrussel, type Pauze } from '@/lib/personeel/tijd'
import { isUuid, isoOf, tekst, verslagOf, linksOf } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/**
 * PATCH — het eigen verslag aanvullen of, als een admin een correctie vroeg,
 * de sessie aanpassen en opnieuw indienen. Goedgekeurde of afgekeurde sessies
 * past een medewerker niet meer aan. Tijdswijzigingen vragen een reden en
 * komen met oude en nieuwe waarden in de auditlog.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const { lid, admin } = g
    const { data: s } = await admin.from('personeel_sessies').select('*').eq('id', id).eq('personeel_id', lid.id).maybeSingle()
    if (!s) return NextResponse.json({ error: 'Sessie niet gevonden' }, { status: 404 })
    if (!['ingediend', 'correctie_gevraagd'].includes(s.status)) return NextResponse.json({ error: s.status === 'actief' ? 'Klok eerst uit.' : 'Deze sessie is al beoordeeld en kan je niet meer aanpassen.' }, { status: 409 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const nu = new Date().toISOString()
    const patch: Record<string, unknown> = { updated_at: nu }
    if ('verslag' in b) patch.verslag = verslagOf(b.verslag)
    if ('links' in b) patch.links = linksOf(b.links, `${lid.id}/sessies/`)
    if ('project' in b) patch.project = tekst(b.project, 200)
    if ('taak' in b) patch.taak = tekst(b.taak, 500)

    const tijd = 'start_at' in b || 'eind_at' in b
    if (tijd) {
      if (s.status !== 'correctie_gevraagd') return NextResponse.json({ error: 'Tijden aanpassen kan enkel als je verantwoordelijke een correctie vroeg.' }, { status: 409 })
      const reden = tekst(b.reden, 500)
      if (!reden) return NextResponse.json({ error: 'Geef kort aan waarom de tijden anders zijn.' }, { status: 400 })
      const na = { start_at: isoOf(b.start_at) ?? s.start_at, eind_at: isoOf(b.eind_at) ?? s.eind_at, pauzes: (s.pauzes ?? []) as Pauze[] }
      const fout = controleerSessie(na)
      if (fout) return NextResponse.json({ error: fout }, { status: 400 })
      const { data: andere } = await admin.from('personeel_sessies').select('id, start_at, eind_at, status').eq('personeel_id', lid.id)
        .gte('start_at', new Date(new Date(na.start_at).getTime() - 86400000).toISOString()).lte('start_at', na.eind_at ?? nu)
      if (overlaptMetSessies({ id, ...na }, (andere ?? []) as never)) return NextResponse.json({ error: 'De aangepaste tijd overlapt met een andere sessie.' }, { status: 409 })
      patch.start_at = na.start_at; patch.eind_at = na.eind_at
      await audit(admin, { personeel_id: lid.id, entiteit: 'sessie', entiteit_id: id, actie: 'tijden_aangepast_door_medewerker', oud: { start_at: s.start_at, eind_at: s.eind_at }, nieuw: { start_at: na.start_at, eind_at: na.eind_at }, reden, actor_email: lid.email, actor_id: lid.auth_user_id })
    }
    const opnieuw = s.status === 'correctie_gevraagd' && b.indienen === true
    if (opnieuw) patch.status = 'ingediend'
    const { error } = await admin.from('personeel_sessies').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    if ('verslag' in b) await audit(admin, { personeel_id: lid.id, entiteit: 'sessie', entiteit_id: id, actie: 'verslag_bijgewerkt', oud: { verslag: s.verslag }, nieuw: { verslag: patch.verslag }, actor_email: lid.email, actor_id: lid.auth_user_id })
    if (opnieuw) {
      const naam = [lid.voornaam, lid.achternaam].filter(Boolean).join(' ')
      await meld(admin, { personeel_id: null, event: 'uren_te_controleren', titel: `Correctie ingediend — ${naam}`, tekst: `${naam} paste de sessie van ${dagBrussel(String(patch.start_at ?? s.start_at)).split('-').reverse().join('/')} ${uurBrussel(String(patch.start_at ?? s.start_at))} aan en diende ze opnieuw in.`, link: '/admin/personeel?tab=uren' })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
