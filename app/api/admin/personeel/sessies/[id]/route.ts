import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, laadTarieven, audit, meld, herboekMaand } from '@/lib/personeel/server'
import { controleerSessie, overlaptMetSessies, gewerkteMinuten, dagBrussel, duurTekst, uurBrussel, type Pauze } from '@/lib/personeel/tijd'
import { sessieKost, tariefOp } from '@/lib/personeel/kost'
import { isUuid, isoOf, tekst, uuidOf } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/**
 * POST { actie, ... } — urencontrole door een admin.
 *  · corrigeren        begin/einde/pauzes/project/klant/taak — reden verplicht
 *  · goedkeuren        kostprijs wordt vastgelegd (snapshot) en de maand herboekt
 *  · afkeuren          reden verplicht
 *  · correctie         de medewerker moet iets aanpassen — vraag verplicht
 *  · opmerking         interne opmerking (nooit zichtbaar voor de medewerker)
 *  · heropenen         een goedkeuring terugdraaien — reden verplicht
 *  · stoppen           een vergeten actieve sessie afsluiten — reden verplicht
 * Elke wijziging komt met oude en nieuwe waarden in de auditlog.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const actie = String(b.actie ?? '')
    const g = await eisPersoneel(actie === 'goedkeuren' || actie === 'afkeuren' || actie === 'heropenen' ? 'goedkeuren' : 'aanpassen'); if (!g.ok) return g.response
    const { admin, persoon } = g
    const { data: s } = await admin.from('personeel_sessies').select('*').eq('id', id).maybeSingle()
    if (!s) return NextResponse.json({ error: 'Sessie niet gevonden' }, { status: 404 })
    const reden = tekst(b.reden, 1000)
    const wie = persoon.email
    const log = (a: string, oud: unknown, nieuw: unknown, r?: string | null) => audit(admin, { personeel_id: s.personeel_id, entiteit: 'sessie', entiteit_id: id, actie: a, oud, nieuw, reden: r ?? reden, actor_email: wie, actor_id: persoon.userId })
    const dagTekst = `${dagBrussel(s.start_at).split('-').reverse().join('/')} ${uurBrussel(s.start_at)}`
    const maandVan = (iso: string) => dagBrussel(iso).slice(0, 7)
    const nu = new Date().toISOString()

    /** Vastgelegde kostprijs volgens het tarief van die dag. */
    const snapshot = async (sess: { start_at: string; eind_at: string | null; pauzes: Pauze[] | null }) => {
      const tarieven = await laadTarieven(admin, s.personeel_id)
      const t = tariefOp(tarieven, dagBrussel(sess.start_at))
      const k = sessieKost(t, gewerkteMinuten(sess))
      return { tarief_id: k.tarief_id, kost_per_uur: k.kost_per_uur, kost_bedrag: k.kost_bedrag, kost_snapshot: { ...k, tarief: t, berekend_op: nu } }
    }

    if (actie === 'corrigeren' || actie === 'stoppen') {
      if (!reden) return NextResponse.json({ error: 'Geef een reden voor deze wijziging.' }, { status: 400 })
      if (actie === 'stoppen' && s.status !== 'actief') return NextResponse.json({ error: 'Deze sessie loopt niet meer.' }, { status: 409 })
      if (actie === 'corrigeren' && s.status === 'actief') return NextResponse.json({ error: 'Sluit een lopende sessie eerst af (knop "Afsluiten").' }, { status: 409 })
      const nieuw: Record<string, unknown> = {}
      if ('start_at' in b) { const v = isoOf(b.start_at); if (!v) return NextResponse.json({ error: 'Ongeldig beginuur.' }, { status: 400 }); nieuw.start_at = v }
      if ('eind_at' in b) { const v = isoOf(b.eind_at); if (!v) return NextResponse.json({ error: 'Ongeldig einduur.' }, { status: 400 }); nieuw.eind_at = v }
      if ('pauzes' in b) {
        const p = Array.isArray(b.pauzes) ? (b.pauzes as Record<string, unknown>[]).map((x) => ({ start: isoOf(x.start), eind: isoOf(x.eind) })) : []
        if (p.some((x) => !x.start || !x.eind)) return NextResponse.json({ error: 'Elke pauze heeft een begin en einde nodig.' }, { status: 400 })
        nieuw.pauzes = p
      }
      if ('client_id' in b) nieuw.client_id = uuidOf(b.client_id)
      if ('opdracht_id' in b) nieuw.opdracht_id = uuidOf(b.opdracht_id)
      if ('project' in b) nieuw.project = tekst(b.project, 200)
      if ('taak' in b) nieuw.taak = tekst(b.taak, 500)
      if (actie === 'stoppen') {
        nieuw.eind_at = nieuw.eind_at ?? nu; nieuw.status = 'ingediend'; nieuw.pauze_actief_sinds = null
        nieuw.pauzes = ((nieuw.pauzes ?? s.pauzes ?? []) as Pauze[]).map((p) => ({ ...p, eind: p.eind ?? String(nieuw.eind_at) }))
      }
      const na = { start_at: String(nieuw.start_at ?? s.start_at), eind_at: (nieuw.eind_at ?? s.eind_at) as string | null, pauzes: (nieuw.pauzes ?? s.pauzes) as Pauze[] }
      const fout = controleerSessie(na)
      if (fout) return NextResponse.json({ error: fout }, { status: 400 })
      const { data: andere } = await admin.from('personeel_sessies').select('id, start_at, eind_at, status').eq('personeel_id', s.personeel_id)
        .gte('start_at', new Date(new Date(na.start_at).getTime() - 86400000).toISOString()).lte('start_at', na.eind_at ?? nu)
      if (overlaptMetSessies({ id, ...na }, (andere ?? []) as never)) return NextResponse.json({ error: 'De aangepaste tijd overlapt met een andere sessie.' }, { status: 409 })
      if (s.status === 'goedgekeurd') Object.assign(nieuw, await snapshot(na))
      nieuw.updated_at = nu
      const { error } = await admin.from('personeel_sessies').update(nieuw).eq('id', id)
      if (error) throw new Error(error.message)
      const oudeWaarden: Record<string, unknown> = {}
      for (const k of Object.keys(nieuw)) if (k !== 'updated_at' && !k.startsWith('kost') && k !== 'tarief_id') oudeWaarden[k] = s[k] ?? null
      const nieuweWaarden = Object.fromEntries(Object.entries(nieuw).filter(([k]) => k !== 'updated_at' && !k.startsWith('kost') && k !== 'tarief_id'))
      await log(actie === 'stoppen' ? 'sessie_afgesloten_door_admin' : 'sessie_gecorrigeerd', { ...oudeWaarden, minuten: gewerkteMinuten(s) }, { ...nieuweWaarden, minuten: gewerkteMinuten(na) })
      if (s.status === 'goedgekeurd') {
        for (const m of new Set([maandVan(s.start_at), maandVan(na.start_at)])) await herboekMaand(admin, s.personeel_id, m, wie, `Goedgekeurde sessie gecorrigeerd: ${reden}`)
      }
      if (actie === 'stoppen') await meld(admin, { personeel_id: s.personeel_id, event: 'vergeten_uitklokken', titel: 'Je sessie werd afgesloten', tekst: `Je sessie van ${dagTekst} liep nog. Een admin sloot ze af: ${reden}. Vul je werkverslag aan als dat nog nodig is.`, link: '/team/uren' })
      return NextResponse.json({ ok: true })
    }

    if (actie === 'goedkeuren') {
      if (!['ingediend', 'correctie_gevraagd', 'afgekeurd'].includes(s.status)) return NextResponse.json({ error: s.status === 'goedgekeurd' ? 'Al goedgekeurd.' : 'Een lopende sessie kan niet goedgekeurd worden.' }, { status: 409 })
      if (!s.eind_at) return NextResponse.json({ error: 'Deze sessie heeft nog geen einduur.' }, { status: 409 })
      const snap = await snapshot(s)
      const { error } = await admin.from('personeel_sessies').update({ status: 'goedgekeurd', beoordeeld_door: wie, beoordeeld_op: nu, correctie_vraag: null, ...snap, updated_at: nu }).eq('id', id)
      if (error) throw new Error(error.message)
      await log('sessie_goedgekeurd', { status: s.status }, { status: 'goedgekeurd', minuten: gewerkteMinuten(s) })
      const boeking = await herboekMaand(admin, s.personeel_id, maandVan(s.start_at), wie, 'Uren goedgekeurd')
      await meld(admin, { personeel_id: s.personeel_id, event: 'uren_goedgekeurd', titel: 'Je uren zijn goedgekeurd', tekst: `Je sessie van ${dagTekst} (${duurTekst(gewerkteMinuten(s))}) is goedgekeurd.`, link: '/team/uren' })
      return NextResponse.json({ ok: true, zonderTarief: !snap.tarief_id, boeking: boeking.actie })
    }

    if (actie === 'afkeuren') {
      if (!reden) return NextResponse.json({ error: 'Geef een reden voor de afkeuring.' }, { status: 400 })
      if (s.status === 'actief') return NextResponse.json({ error: 'Sluit de sessie eerst af.' }, { status: 409 })
      const wasGoed = s.status === 'goedgekeurd'
      const { error } = await admin.from('personeel_sessies').update({ status: 'afgekeurd', beoordeeld_door: wie, beoordeeld_op: nu, admin_opmerking: reden, kost_bedrag: null, kost_per_uur: null, updated_at: nu }).eq('id', id)
      if (error) throw new Error(error.message)
      await log('sessie_afgekeurd', { status: s.status }, { status: 'afgekeurd' })
      if (wasGoed) await herboekMaand(admin, s.personeel_id, maandVan(s.start_at), wie, `Goedgekeurde uren afgekeurd: ${reden}`)
      await meld(admin, { personeel_id: s.personeel_id, event: 'uren_afgekeurd', titel: 'Je uren zijn afgekeurd', tekst: `Je sessie van ${dagTekst} werd afgekeurd. Reden: ${reden}`, link: '/team/uren' })
      return NextResponse.json({ ok: true })
    }

    if (actie === 'correctie') {
      const vraag = tekst(b.vraag, 1000)
      if (!vraag) return NextResponse.json({ error: 'Schrijf wat de medewerker moet aanpassen.' }, { status: 400 })
      if (!['ingediend', 'goedgekeurd', 'afgekeurd'].includes(s.status)) return NextResponse.json({ error: 'Voor deze sessie kan geen correctie gevraagd worden.' }, { status: 409 })
      const wasGoed = s.status === 'goedgekeurd'
      const { error } = await admin.from('personeel_sessies').update({ status: 'correctie_gevraagd', correctie_vraag: vraag, beoordeeld_door: wie, beoordeeld_op: nu, ...(wasGoed ? { kost_bedrag: null, kost_per_uur: null } : {}), updated_at: nu }).eq('id', id)
      if (error) throw new Error(error.message)
      await log('correctie_gevraagd', { status: s.status }, { status: 'correctie_gevraagd', vraag }, vraag)
      if (wasGoed) await herboekMaand(admin, s.personeel_id, maandVan(s.start_at), wie, `Correctie gevraagd op goedgekeurde uren: ${vraag}`)
      await meld(admin, { personeel_id: s.personeel_id, event: 'correctie_gevraagd', titel: 'Een correctie gevraagd op je uren', tekst: `Sessie van ${dagTekst}: ${vraag}`, link: '/team/uren' })
      return NextResponse.json({ ok: true })
    }

    if (actie === 'heropenen') {
      if (s.status !== 'goedgekeurd') return NextResponse.json({ error: 'Enkel een goedgekeurde sessie kan heropend worden.' }, { status: 409 })
      if (!reden) return NextResponse.json({ error: 'Geef een reden.' }, { status: 400 })
      const { error } = await admin.from('personeel_sessies').update({ status: 'ingediend', kost_bedrag: null, kost_per_uur: null, updated_at: nu }).eq('id', id)
      if (error) throw new Error(error.message)
      await log('goedkeuring_teruggedraaid', { status: 'goedgekeurd', kost_bedrag: s.kost_bedrag }, { status: 'ingediend' })
      await herboekMaand(admin, s.personeel_id, maandVan(s.start_at), wie, `Goedkeuring teruggedraaid: ${reden}`)
      return NextResponse.json({ ok: true })
    }

    if (actie === 'opmerking') {
      const opm = tekst(b.opmerking, 2000)
      await admin.from('personeel_sessies').update({ admin_opmerking: opm, updated_at: nu }).eq('id', id)
      await log('opmerking', { admin_opmerking: s.admin_opmerking }, { admin_opmerking: opm }, null)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * DELETE ?reden — gelogde uren definitief verwijderen (bv. dubbel of per
 * vergissing geregistreerd). Reden verplicht; de volledige oude sessie gaat
 * naar de auditlog. Waren de uren goedgekeurd, dan wordt de personeelskost van
 * die maand in Financiën meteen herberekend.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    const { admin, persoon } = g
    const reden = tekst(req.nextUrl.searchParams.get('reden'), 1000)
    if (!reden) return NextResponse.json({ error: 'Geef een reden om deze uren te verwijderen.' }, { status: 400 })
    const { data: s } = await admin.from('personeel_sessies').select('*').eq('id', id).maybeSingle()
    if (!s) return NextResponse.json({ error: 'Sessie niet gevonden' }, { status: 404 })
    const { error } = await admin.from('personeel_sessies').delete().eq('id', id)
    if (error) throw new Error(error.message)
    await audit(admin, { personeel_id: s.personeel_id, entiteit: 'sessie', entiteit_id: id, actie: 'sessie_verwijderd', oud: { ...s, minuten: gewerkteMinuten(s) }, nieuw: null, reden, actor_email: persoon.email, actor_id: persoon.userId })
    let boeking: string | null = null
    if (s.status === 'goedgekeurd') boeking = (await herboekMaand(admin, s.personeel_id, dagBrussel(s.start_at).slice(0, 7), persoon.email, `Goedgekeurde uren verwijderd: ${reden}`)).actie
    await meld(admin, { personeel_id: s.personeel_id, event: 'uren_afgekeurd', titel: 'Een urenregistratie werd verwijderd', tekst: `Je sessie van ${dagBrussel(s.start_at).split('-').reverse().join('/')} ${uurBrussel(s.start_at)} werd verwijderd. Reden: ${reden}`, link: '/team/uren' })
    return NextResponse.json({ ok: true, boeking })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
