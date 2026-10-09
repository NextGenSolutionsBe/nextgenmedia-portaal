import { safeMessage } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { requireStaff } from '@/lib/supabase/server'

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
    // deadline meer. Het endpoint blijft voor toekomstige tellers.
    return NextResponse.json({})
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
