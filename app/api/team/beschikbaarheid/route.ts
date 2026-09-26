import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisTeamLid, audit, meld } from '@/lib/personeel/server'
import { BESCHIKBAARHEID_KOLOMMEN, beschikbaarheidVoorMedewerker } from '@/lib/personeel/rechten'
import { controleerBlokken, type Blok } from '@/lib/personeel/planning'
import { dagOf, tekst } from '@/lib/personeel/invoer'
import { dagBrussel, plusDagen, minutenVanUur } from '@/lib/personeel/tijd'

export const dynamic = 'force-dynamic'

/** GET ?van&tot — de eigen beschikbaarheden (met status en eventueel voorstel). */
export async function GET(req: NextRequest) {
  try {
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const sp = req.nextUrl.searchParams
    const vandaag = dagBrussel(new Date())
    const van = dagOf(sp.get('van')) ?? plusDagen(vandaag, -31), tot = dagOf(sp.get('tot')) ?? plusDagen(vandaag, 92)
    const { data, error } = await g.admin.from('personeel_beschikbaarheid').select(BESCHIKBAARHEID_KOLOMMEN).eq('personeel_id', g.lid.id).gte('datum', van).lte('datum', tot).order('datum').order('start_tijd')
    if (error) throw new Error(error.message)
    return NextResponse.json({ beschikbaarheid: ((data ?? []) as unknown as Record<string, unknown>[]).map(beschikbaarheidVoorMedewerker), van, tot })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST { datum, blokken: [{ start, eind }], opmerking? } — beschikbaarheid
 * doorgeven voor één dag, met één of meerdere tijdsblokken. Dit is een aanbod,
 * geen planning: pas na goedkeuring door een admin ontstaat een werkblok.
 */
export async function POST(req: NextRequest) {
  try {
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const { lid, admin } = g
    const b = (await req.json().catch(() => ({}))) as { datum?: string; blokken?: Blok[]; opmerking?: string }
    const datum = dagOf(b.datum)
    const blokken = Array.isArray(b.blokken) ? b.blokken.slice(0, 8) : []
    const fout = controleerBlokken(datum ?? '', blokken)
    if (fout) return NextResponse.json({ error: fout }, { status: 400 })
    if (datum! < dagBrussel(new Date())) return NextResponse.json({ error: 'Een dag in het verleden kan je niet meer doorgeven.' }, { status: 400 })
    // Niet overlappen met een eigen, nog geldige beschikbaarheid op dezelfde dag.
    const { data: bestaand } = await admin.from('personeel_beschikbaarheid').select('start_tijd, eind_tijd, status').eq('personeel_id', lid.id).eq('datum', datum).in('status', ['ingediend', 'goedgekeurd', 'gedeeltelijk'])
    for (const nb of blokken) {
      const [s, e] = [minutenVanUur(nb.start), minutenVanUur(nb.eind)]
      if (((bestaand ?? []) as { start_tijd: string; eind_tijd: string }[]).some((x) => s < minutenVanUur(x.eind_tijd) && minutenVanUur(x.start_tijd) < e)) {
        return NextResponse.json({ error: `Je gaf voor ${nb.start}–${nb.eind} al beschikbaarheid door op deze dag.` }, { status: 409 })
      }
    }
    const opmerking = tekst(b.opmerking, 1000)
    const rijen = blokken.map((x) => ({ personeel_id: lid.id, datum, start_tijd: x.start.slice(0, 5), eind_tijd: x.eind.slice(0, 5), opmerking, status: 'ingediend' }))
    const { data, error } = await admin.from('personeel_beschikbaarheid').insert(rijen).select('id')
    if (error) throw new Error(error.message)
    await audit(admin, { personeel_id: lid.id, entiteit: 'beschikbaarheid', entiteit_id: (data ?? []).map((r: { id: string }) => r.id).join(','), actie: 'beschikbaarheid_ingediend', nieuw: { datum, blokken, opmerking }, actor_email: lid.email, actor_id: lid.auth_user_id })
    const naam = [lid.voornaam, lid.achternaam].filter(Boolean).join(' ')
    await meld(admin, { personeel_id: null, event: 'beschikbaarheid_ingediend', titel: `Beschikbaarheid — ${naam}`, tekst: `${naam} is beschikbaar op ${datum!.split('-').reverse().join('/')}: ${blokken.map((x) => `${x.start}–${x.eind}`).join(', ')}${opmerking ? ` (${opmerking})` : ''}.`, link: '/admin/personeel?tab=planning' })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
