import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisTeamLid, audit } from '@/lib/personeel/server'
import { BESCHIKBAARHEID_KOLOMMEN, beschikbaarheidVoorMedewerker } from '@/lib/personeel/rechten'
import { voegBeschikbaarheidToe } from '@/lib/personeel/beschikbaarheid-server'
import { dagOf, tekst } from '@/lib/personeel/invoer'
import { dagBrussel, plusDagen } from '@/lib/personeel/tijd'
import type { Blok } from '@/lib/personeel/planning'

export const dynamic = 'force-dynamic'

/** GET ?van&tot — de eigen beschikbaarheden (enkel de geldige, niet de ingetrokken). */
export async function GET(req: NextRequest) {
  try {
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const sp = req.nextUrl.searchParams
    const vandaag = dagBrussel(new Date())
    const van = dagOf(sp.get('van')) ?? plusDagen(vandaag, -31), tot = dagOf(sp.get('tot')) ?? plusDagen(vandaag, 92)
    const { data, error } = await g.admin.from('personeel_beschikbaarheid').select(BESCHIKBAARHEID_KOLOMMEN)
      .eq('personeel_id', g.lid.id).gte('datum', van).lte('datum', tot).in('status', ['ingediend', 'goedgekeurd', 'gedeeltelijk'])
      .order('datum').order('start_tijd')
    if (error) throw new Error(error.message)
    return NextResponse.json({ beschikbaarheid: ((data ?? []) as unknown as Record<string, unknown>[]).map(beschikbaarheidVoorMedewerker), van, tot })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/**
 * POST { datum, blokken: [{ start, eind }], opmerking? } — aangeven wanneer je vrij
 * bent. Meteen bewaard, geen goedkeuring nodig: NextGenMedia kan je binnen die
 * uren inboeken, en jij bevestigt elke inboeking.
 */
export async function POST(req: NextRequest) {
  try {
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const { lid, admin } = g
    const b = (await req.json().catch(() => ({}))) as { datum?: string; blokken?: Blok[]; opmerking?: string }
    const datum = dagOf(b.datum)
    const blokken = Array.isArray(b.blokken) ? b.blokken.slice(0, 8) : []
    if (!datum || !blokken.length) return NextResponse.json({ error: 'Kies een dag en een tijdsblok.' }, { status: 400 })
    const opmerking = tekst(b.opmerking, 1000)
    const ids: string[] = []
    for (const x of blokken) {
      const r = await voegBeschikbaarheidToe(admin, { personeelId: lid.id, datum, start: String(x.start ?? ''), eind: String(x.eind ?? ''), opmerking })
      if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
      if (r.id) ids.push(r.id)
    }
    await audit(admin, { personeel_id: lid.id, entiteit: 'beschikbaarheid', entiteit_id: ids.join(','), actie: 'beschikbaarheid_ingediend', nieuw: { datum, blokken, opmerking }, actor_email: lid.email, actor_id: lid.auth_user_id })
    return NextResponse.json({ ok: true, ids })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
