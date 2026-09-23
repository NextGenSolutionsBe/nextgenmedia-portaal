import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisTeamLid } from '@/lib/personeel/server'
import { SESSIE_KOLOMMEN, sessieVoorMedewerker } from '@/lib/personeel/rechten'
import { dagOf } from '@/lib/personeel/invoer'
import { plusDagen, dagBrussel } from '@/lib/personeel/tijd'

export const dynamic = 'force-dynamic'

/**
 * GET ?van&tot — de eigen werksessies: datum, begin, einde, pauzes, project,
 * eigen verslag en goedkeuringsstatus. Geen loon, kost of adminnotities.
 */
export async function GET(req: NextRequest) {
  try {
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const sp = req.nextUrl.searchParams
    const vandaag = dagBrussel(new Date())
    const van = dagOf(sp.get('van')) ?? plusDagen(vandaag, -60), tot = dagOf(sp.get('tot')) ?? vandaag
    const [{ data, error }, { data: klanten }] = await Promise.all([
      g.admin.from('personeel_sessies').select(SESSIE_KOLOMMEN).eq('personeel_id', g.lid.id)
        .gte('start_at', `${plusDagen(van, -1)}T00:00:00Z`).lte('start_at', `${plusDagen(tot, 1)}T23:59:59Z`).order('start_at', { ascending: false }).limit(500),
      g.admin.from('clients').select('id, company_name').limit(2000),
    ])
    if (error) throw new Error(error.message)
    const klant = new Map(((klanten ?? []) as { id: string; company_name: string }[]).map((k) => [k.id, k.company_name]))
    const sessies = ((data ?? []) as unknown as Record<string, unknown>[]).map((s) => ({ ...sessieVoorMedewerker(s), klant: s.client_id ? klant.get(String(s.client_id)) ?? null : null }))
    return NextResponse.json({ sessies, van, tot })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
