import { safeMessage } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { requireStaff, createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'

export const dynamic = 'force-dynamic'

/**
 * Telbolletjes voor de zijbalk.
 *
 * Bewust één klein endpoint met alleen AANTALLEN — geen inhoud. De zijbalk
 * staat in de layout en laadt dus bij elke volledige paginalading; die mag
 * nooit duur worden. Vandaar `head: true`: Postgres telt, er reist geen enkele
 * rij over de lijn.
 */
export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    // Het bolletje bij Opdrachten ("te laat") is weg: opdrachten hebben geen
    // deadline meer.
    const uit: Record<string, number> = {}
    // Community: wat wij moeten beantwoorden (te beantwoorden + klant koos),
    // enkel bij klanten waarvoor community management aan staat.
    if (await magIk('community', 'bekijken')) {
      try {
        const admin = createAdminSupabaseClient()
        const { data: inst } = await admin.from('community_instellingen').select('client_id').eq('actief', true)
        const ids = (inst ?? []).map((i: { client_id: string }) => i.client_id)
        if (ids.length) {
          const { count } = await admin.from('community_berichten').select('id', { count: 'exact', head: true })
            .in('client_id', ids).in('status', ['te_beantwoorden', 'klant_gekozen'])
          if (count) uit.community = count
        }
      } catch { /* tabellen nog niet gemigreerd → geen bolletje */ }
    }
    return NextResponse.json(uit)
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
