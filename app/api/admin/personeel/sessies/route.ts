import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, magFinancieel, audit } from '@/lib/personeel/server'
import { isSessieStatus } from '@/lib/personeel/model'
import { controleerSessie, overlaptMetSessies, plusDagen, gewerkteMinuten, dagBrussel } from '@/lib/personeel/tijd'
import { dagOf, isoOf, tekst, uuidOf } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/** GET ?status&personeel_id&van&tot — urenregistraties voor de controle. */
export async function GET(req: NextRequest) {
  try {
    const g = await eisPersoneel('bekijken'); if (!g.ok) return g.response
    const sp = req.nextUrl.searchParams
    const financieel = await magFinancieel(g.persoon)
    const kol = financieel ? '*' : 'id, personeel_id, start_at, eind_at, pauzes, pauze_actief_sinds, status, client_id, opdracht_id, project, taak, planning_id, verslag, links, admin_opmerking, correctie_vraag, beoordeeld_door, beoordeeld_op, bron, created_at'
    let q = g.admin.from('personeel_sessies').select(kol).order('start_at', { ascending: false }).limit(1000)
    const status = sp.get('status')
    if (status === 'open') q = q.in('status', ['ingediend', 'correctie_gevraagd', 'actief'])
    else if (isSessieStatus(status)) q = q.eq('status', status)
    const pid = uuidOf(sp.get('personeel_id')); if (pid) q = q.eq('personeel_id', pid)
    const van = dagOf(sp.get('van')), tot = dagOf(sp.get('tot'))
    if (van) q = q.gte('start_at', `${plusDagen(van, -1)}T00:00:00Z`)
    if (tot) q = q.lte('start_at', `${plusDagen(tot, 1)}T23:59:59Z`)
    const [{ data, error }, { data: mensen }, { data: klanten }] = await Promise.all([
      q, g.admin.from('personeel').select('id, voornaam, achternaam, type'), g.admin.from('clients').select('id, company_name').limit(2000),
    ])
    if (error) throw new Error(error.message)
    const naam = new Map(((mensen ?? []) as { id: string; voornaam: string; achternaam: string | null }[]).map((m) => [m.id, [m.voornaam, m.achternaam].filter(Boolean).join(' ')]))
    const klant = new Map(((klanten ?? []) as { id: string; company_name: string }[]).map((k) => [k.id, k.company_name]))
    const rijen = ((data ?? []) as unknown as Record<string, unknown>[])
      .filter((s) => (!van || dagBrussel(String(s.start_at)) >= van) && (!tot || dagBrussel(String(s.start_at)) <= tot))
      .map((s) => ({ ...s, medewerker: naam.get(String(s.personeel_id)) ?? '—', klant: s.client_id ? klant.get(String(s.client_id)) ?? null : null, minuten: gewerkteMinuten(s as never) }))
    return NextResponse.json({ sessies: rijen, magFinancieel: financieel })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** POST — een admin registreert zelf een sessie (bv. vergeten in te klokken). Altijd met reden. */
export async function POST(req: NextRequest) {
  try {
    const g = await eisPersoneel('toevoegen'); if (!g.ok) return g.response
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const pid = uuidOf(b.personeel_id)
    const start = isoOf(b.start_at), eind = isoOf(b.eind_at)
    const reden = tekst(b.reden, 500)
    if (!pid || !start || !eind) return NextResponse.json({ error: 'Kies een medewerker en vul begin- en einduur in.' }, { status: 400 })
    if (!reden) return NextResponse.json({ error: 'Geef een reden voor deze manuele registratie.' }, { status: 400 })
    const fout = controleerSessie({ start_at: start, eind_at: eind, pauzes: [] })
    if (fout) return NextResponse.json({ error: fout }, { status: 400 })
    const { data: andere } = await g.admin.from('personeel_sessies').select('id, start_at, eind_at, status').eq('personeel_id', pid).gte('start_at', new Date(new Date(start).getTime() - 86400000).toISOString()).lte('start_at', eind)
    if (overlaptMetSessies({ start_at: start, eind_at: eind }, (andere ?? []) as never)) return NextResponse.json({ error: 'Deze tijd overlapt met een andere sessie van deze medewerker.' }, { status: 409 })
    const rij = {
      personeel_id: pid, start_at: start, eind_at: eind, status: 'ingediend', bron: 'admin',
      client_id: uuidOf(b.client_id), opdracht_id: uuidOf(b.opdracht_id), project: tekst(b.project, 200), taak: tekst(b.taak, 500),
      verslag: { taak: tekst(b.taak, 500) }, admin_opmerking: reden,
    }
    const { data, error } = await g.admin.from('personeel_sessies').insert(rij).select('id').single()
    if (error) throw new Error(error.message)
    await audit(g.admin, { personeel_id: pid, entiteit: 'sessie', entiteit_id: data.id, actie: 'sessie_manueel_toegevoegd', nieuw: rij, reden, actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

