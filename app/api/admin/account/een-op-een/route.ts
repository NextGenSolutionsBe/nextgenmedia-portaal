import { NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { leesPersoon } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { leesActies } from '@/lib/ritme/model'

export const dynamic = 'force-dynamic'

/** Mijn 1-op-1's (fase 7): enkel gesprekken over mij of die ik voerde. Lezen. */
export async function GET() {
  try {
    const p = await leesPersoon()
    if (!p) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { data, error } = await createAdminSupabaseClient().from('een_op_een')
      .select('id, datum, notities, afspraken, met_naam, medewerker_user_id, met_user_id')
      .or(`medewerker_user_id.eq.${p.userId},met_user_id.eq.${p.userId}`).is('verwijderd_op', null).order('datum', { ascending: false }).limit(50)
    if (error) return NextResponse.json({ gesprekken: [] })
    return NextResponse.json({ gesprekken: ((data ?? []) as Record<string, unknown>[]).map((r) => ({ id: r.id, datum: r.datum, notities: r.notities, met_naam: r.met_naam, over_mij: r.medewerker_user_id === p.userId, afspraken: leesActies(r.afspraken) })) })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 400 }) }
}
