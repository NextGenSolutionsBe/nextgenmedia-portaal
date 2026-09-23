import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisTeamLid, audit, meld } from '@/lib/personeel/server'
import { controleerSessie, overlaptMetSessies, gewerkteMinuten, duurTekst, dagBrussel, uurBrussel, type Pauze } from '@/lib/personeel/tijd'
import { SESSIE_KOLOMMEN, sessieVoorMedewerker } from '@/lib/personeel/rechten'
import { tekst, uuidOf, verslagOf, linksOf } from '@/lib/personeel/invoer'
import { isWerkstatus } from '@/lib/personeel/model'

export const dynamic = 'force-dynamic'

/**
 * POST { actie: 'in' | 'pauze' | 'hervat' | 'uit', ... } — in- en uitklokken.
 *  · in     start nu; optioneel voor een werkblok, klant, project of taak.
 *           Nooit twee actieve sessies (ook de databank bewaakt dat).
 *  · pauze  / hervat — een pauze telt niet als gewerkte tijd.
 *  · uit    einde nu, duur wordt berekend; een kort werkverslag is verplicht.
 * De tijden komen altijd van de server, nooit van het toestel.
 */
export async function POST(req: NextRequest) {
  try {
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const { lid, admin } = g
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const nu = new Date().toISOString()
    const { data: actief } = await admin.from('personeel_sessies').select('*').eq('personeel_id', lid.id).eq('status', 'actief').maybeSingle()
    const naam = [lid.voornaam, lid.achternaam].filter(Boolean).join(' ')

    if (b.actie === 'in') {
      if (actief) return NextResponse.json({ error: 'Je bent al ingeklokt.', sessie: sessieVoorMedewerker(actief) }, { status: 409 })
      const rij: Record<string, unknown> = { personeel_id: lid.id, start_at: nu, status: 'actief', bron: 'inklok', project: tekst(b.project, 200), taak: tekst(b.taak, 500), client_id: uuidOf(b.client_id), opdracht_id: uuidOf(b.opdracht_id) }
      const planningId = uuidOf(b.planning_id)
      if (planningId) {
        const { data: pl } = await admin.from('personeel_planning').select('id, client_id, opdracht_id, project, taak, werkstatus').eq('id', planningId).eq('personeel_id', lid.id).maybeSingle()
        if (!pl) return NextResponse.json({ error: 'Dit werkblok hoort niet bij jou.' }, { status: 403 })
        Object.assign(rij, { planning_id: pl.id, client_id: rij.client_id ?? pl.client_id, opdracht_id: rij.opdracht_id ?? pl.opdracht_id, project: rij.project ?? pl.project, taak: rij.taak ?? pl.taak })
        if (pl.werkstatus === 'nog_te_starten') await admin.from('personeel_planning').update({ werkstatus: 'bezig', updated_at: nu }).eq('id', pl.id)
      }
      const { data, error } = await admin.from('personeel_sessies').insert(rij).select(SESSIE_KOLOMMEN).single()
      if (error) {
        if (/duplicate|unique/i.test(error.message)) return NextResponse.json({ error: 'Je bent al ingeklokt (op een ander toestel?). Vernieuw de pagina.' }, { status: 409 })
        throw new Error(error.message)
      }
      await audit(admin, { personeel_id: lid.id, entiteit: 'sessie', entiteit_id: (data as unknown as { id: string }).id, actie: 'ingeklokt', nieuw: { start_at: nu, planning_id: rij.planning_id ?? null }, actor_email: lid.email, actor_id: lid.auth_user_id })
      return NextResponse.json({ ok: true, sessie: data })
    }

    if (!actief) return NextResponse.json({ error: 'Je bent niet ingeklokt.' }, { status: 409 })
    const pauzes = ((actief.pauzes ?? []) as Pauze[]).slice()

    if (b.actie === 'pauze') {
      if (pauzes.some((p) => !p.eind)) return NextResponse.json({ error: 'Je pauze loopt al.' }, { status: 409 })
      pauzes.push({ start: nu, eind: null })
      await admin.from('personeel_sessies').update({ pauzes, pauze_actief_sinds: nu, updated_at: nu }).eq('id', actief.id)
      return NextResponse.json({ ok: true })
    }
    if (b.actie === 'hervat') {
      const open = pauzes.find((p) => !p.eind)
      if (!open) return NextResponse.json({ error: 'Er loopt geen pauze.' }, { status: 409 })
      open.eind = nu
      await admin.from('personeel_sessies').update({ pauzes, pauze_actief_sinds: null, updated_at: nu }).eq('id', actief.id)
      return NextResponse.json({ ok: true })
    }

    if (b.actie === 'uit') {
      const verslag = verslagOf(b.verslag)
      if (!verslag.taak && !verslag.content) return NextResponse.json({ error: 'Vul kort in welke taak je deed of wat je bewerkte.' }, { status: 400 })
      for (const p of pauzes) if (!p.eind) p.eind = nu
      const na = { start_at: String(actief.start_at), eind_at: nu, pauzes }
      const fout = controleerSessie(na)
      if (fout) return NextResponse.json({ error: fout }, { status: 400 })
      const { data: andere } = await admin.from('personeel_sessies').select('id, start_at, eind_at, status').eq('personeel_id', lid.id).neq('id', actief.id)
        .gte('start_at', new Date(new Date(na.start_at).getTime() - 86400000).toISOString()).lte('start_at', nu)
      if (overlaptMetSessies({ id: actief.id, ...na }, (andere ?? []) as never)) return NextResponse.json({ error: 'Deze sessie overlapt met een andere registratie. Neem contact op met je verantwoordelijke.' }, { status: 409 })
      const patch = {
        eind_at: nu, pauzes, pauze_actief_sinds: null, status: 'ingediend', verslag,
        links: linksOf(b.links, `${lid.id}/sessies/`),
        project: tekst(b.project, 200) ?? verslag.project ?? actief.project, taak: verslag.taak ?? actief.taak, updated_at: nu,
      }
      const { error } = await admin.from('personeel_sessies').update(patch).eq('id', actief.id)
      if (error) throw new Error(error.message)
      const min = gewerkteMinuten(na)
      await audit(admin, { personeel_id: lid.id, entiteit: 'sessie', entiteit_id: actief.id, actie: 'uitgeklokt', nieuw: { eind_at: nu, minuten: min }, actor_email: lid.email, actor_id: lid.auth_user_id })
      // De voortgang van het werkblok meteen mee bijwerken als de medewerker dat aangaf.
      if (actief.planning_id && isWerkstatus(b.werkstatus)) {
        await admin.from('personeel_planning').update({ werkstatus: b.werkstatus, voortgang: verslag.todo ?? undefined, updated_at: nu }).eq('id', actief.planning_id).eq('personeel_id', lid.id)
      }
      await meld(admin, { personeel_id: null, event: 'uren_te_controleren', titel: `Uren te controleren — ${naam}`, tekst: `${naam} klokte uit: ${dagBrussel(na.start_at).split('-').reverse().join('/')} ${uurBrussel(na.start_at)}–${uurBrussel(nu)} (${duurTekst(min)}). Taak: ${verslag.taak ?? verslag.content ?? '—'}`, link: `/admin/personeel?tab=uren` })
      return NextResponse.json({ ok: true, minuten: min })
    }

    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
