import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisTeamLid } from '@/lib/personeel/server'
import { PLANNING_KOLOMMEN, BESCHIKBAARHEID_KOLOMMEN, SESSIE_KOLOMMEN, planningVoorMedewerker, beschikbaarheidVoorMedewerker, sessieVoorMedewerker, bevatFinancieel } from '@/lib/personeel/rechten'
import { dagOf } from '@/lib/personeel/invoer'
import { dagBrussel, plusDagen } from '@/lib/personeel/tijd'

export const dynamic = 'force-dynamic'

/**
 * GET ?van&tot — de eigen kalender: werkblokken (met briefing), eigen
 * beschikbaarheden en eigen werksessies. Nooit iets van andere medewerkers.
 */
export async function GET(req: NextRequest) {
  try {
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const sp = req.nextUrl.searchParams
    const vandaag = dagBrussel(new Date())
    const van = dagOf(sp.get('van')) ?? plusDagen(vandaag, -31), tot = dagOf(sp.get('tot')) ?? plusDagen(vandaag, 62)
    const id = g.lid.id
    const [planning, beschikbaar, sessies, klanten, opdrachten] = await Promise.all([
      g.admin.from('personeel_planning').select(PLANNING_KOLOMMEN).eq('personeel_id', id).gte('datum', van).lte('datum', tot).order('datum').order('start_tijd'),
      g.admin.from('personeel_beschikbaarheid').select(BESCHIKBAARHEID_KOLOMMEN).eq('personeel_id', id).gte('datum', van).lte('datum', tot).neq('status', 'ingetrokken'),
      g.admin.from('personeel_sessies').select(SESSIE_KOLOMMEN).eq('personeel_id', id).gte('start_at', `${plusDagen(van, -1)}T00:00:00Z`).lte('start_at', `${plusDagen(tot, 1)}T23:59:59Z`),
      g.admin.from('clients').select('id, company_name').limit(2000),
      g.admin.from('opdrachten').select('id, titel').limit(2000),
    ])
    const klant = new Map(((klanten.data ?? []) as { id: string; company_name: string }[]).map((k) => [k.id, k.company_name]))
    const opdracht = new Map(((opdrachten.data ?? []) as { id: string; titel: string }[]).map((o) => [o.id, o.titel]))
    const antwoord = {
      van, tot,
      planning: ((planning.data ?? []) as unknown as Record<string, unknown>[]).map((p) => ({ ...planningVoorMedewerker(p), klant: p.client_id ? klant.get(String(p.client_id)) ?? null : null, opdracht: p.opdracht_id ? opdracht.get(String(p.opdracht_id)) ?? null : null })),
      beschikbaarheid: ((beschikbaar.data ?? []) as unknown as Record<string, unknown>[]).map(beschikbaarheidVoorMedewerker),
      sessies: ((sessies.data ?? []) as unknown as Record<string, unknown>[]).map(sessieVoorMedewerker),
    }
    if (bevatFinancieel(antwoord)) return NextResponse.json({ error: 'Interne fout: onverwachte gegevens.' }, { status: 500 })
    return NextResponse.json(antwoord)
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
