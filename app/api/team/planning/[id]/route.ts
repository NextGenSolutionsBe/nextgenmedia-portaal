import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisTeamLid, audit, meld } from '@/lib/personeel/server'
import { isWerkstatus, WERKSTATUS } from '@/lib/personeel/model'
import { isUuid, tekst } from '@/lib/personeel/invoer'
import { bevestigingVan } from '@/lib/personeel/planning'
import { syncWerkblokNaarClickup } from '@/lib/personeel/planning-clickup'

export const dynamic = 'force-dynamic'

/** PATCH { werkstatus?, voortgang? } — de medewerker werkt de voortgang van een eigen werkblok bij. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const { data: p } = await g.admin.from('personeel_planning').select('id, werkstatus, voortgang, status, datum, taak').eq('id', id).eq('personeel_id', g.lid.id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Werkblok niet gevonden' }, { status: 404 })
    if (p.status === 'geannuleerd') return NextResponse.json({ error: 'Dit werkblok werd geannuleerd.' }, { status: 409 })
    const b = (await req.json().catch(() => ({}))) as { werkstatus?: string; voortgang?: string }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (b.werkstatus !== undefined) { if (!isWerkstatus(b.werkstatus)) return NextResponse.json({ error: 'Onbekende status.' }, { status: 400 }); patch.werkstatus = b.werkstatus }
    if (b.voortgang !== undefined) patch.voortgang = tekst(b.voortgang, 5000)
    await g.admin.from('personeel_planning').update(patch).eq('id', id)
    await audit(g.admin, { personeel_id: g.lid.id, entiteit: 'planning', entiteit_id: id, actie: 'voortgang_bijgewerkt', oud: { werkstatus: p.werkstatus, voortgang: p.voortgang }, nieuw: patch, actor_email: g.lid.email, actor_id: g.lid.auth_user_id })
    if (patch.werkstatus && patch.werkstatus !== p.werkstatus && ['klaar_voor_controle', 'geblokkeerd'].includes(String(patch.werkstatus))) {
      const naam = [g.lid.voornaam, g.lid.achternaam].filter(Boolean).join(' ')
      await meld(g.admin, { personeel_id: null, event: 'uren_te_controleren', titel: `${WERKSTATUS[patch.werkstatus as keyof typeof WERKSTATUS].label} — ${naam}`, tekst: `${p.taak ?? 'Werkblok'} (${String(p.datum).split('-').reverse().join('/')}).${patch.voortgang ? ` ${patch.voortgang}` : ''}`, link: '/admin/personeel?tab=planning' })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST { actie: 'bevestigen' | 'weigeren', reden? } — de medewerker bevestigt
 * een inplanning (of laat weten dat het niet lukt). Na bevestiging gaat het
 * werkblok naar ClickUp, toegewezen aan de medewerker als die daar bestaat.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const { data: p } = await g.admin.from('personeel_planning').select('id, status, bevestiging, datum, start_tijd, eind_tijd, taak, project').eq('id', id).eq('personeel_id', g.lid.id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Werkblok niet gevonden' }, { status: 404 })
    if (p.status === 'geannuleerd') return NextResponse.json({ error: 'Dit werkblok werd geannuleerd.' }, { status: 409 })
    const b = (await req.json().catch(() => ({}))) as { actie?: string; reden?: string }
    if (b.actie !== 'bevestigen' && b.actie !== 'weigeren') return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    const huidig = bevestigingVan(p)
    const nieuw = b.actie === 'bevestigen' ? 'bevestigd' : 'geweigerd'
    if (huidig === nieuw) return NextResponse.json({ ok: true })
    const reden = tekst(b.reden, 500)
    if (nieuw === 'geweigerd' && !reden) return NextResponse.json({ error: 'Laat kort weten waarom het niet lukt.' }, { status: 400 })
    const nu = new Date().toISOString()
    await g.admin.from('personeel_planning').update({ bevestiging: nieuw, bevestigd_op: nieuw === 'bevestigd' ? nu : null, bevestiging_reden: reden, updated_at: nu }).eq('id', id)
    await audit(g.admin, { personeel_id: g.lid.id, entiteit: 'planning', entiteit_id: id, actie: nieuw === 'bevestigd' ? 'werkblok_bevestigd' : 'werkblok_geweigerd', oud: { bevestiging: huidig }, nieuw: { bevestiging: nieuw }, reden, actor_email: g.lid.email, actor_id: g.lid.auth_user_id })
    const clickup = nieuw === 'bevestigd' ? await syncWerkblokNaarClickup(g.admin, id) : null
    const naam = [g.lid.voornaam, g.lid.achternaam].filter(Boolean).join(' ')
    const wanneer = `${String(p.datum).split('-').reverse().join('/')} ${String(p.start_tijd).slice(0, 5)}–${String(p.eind_tijd).slice(0, 5)}`
    await meld(g.admin, {
      personeel_id: null, event: 'planning_bevestigd',
      titel: nieuw === 'bevestigd' ? `${naam} bevestigt: ${p.taak ?? p.project ?? 'werkblok'}` : `${naam} kan niet: ${p.taak ?? p.project ?? 'werkblok'}`,
      tekst: `${wanneer}.${reden ? ` ${reden}` : ''}${clickup?.status === 'zonder_toegewezene' ? ' In ClickUp gezet zonder toegewezen persoon (niet gevonden in de werkruimte).' : clickup?.status === 'fout' ? ' Let op: ClickUp-taak niet aangemaakt.' : ''}`,
      link: '/admin/personeel?tab=planning',
    })
    return NextResponse.json({ ok: true, bevestiging: nieuw })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
