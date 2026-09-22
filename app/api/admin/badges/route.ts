import { safeMessage } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { OPEN_STATUSSEN, vandaagISO } from '@/lib/opdrachten'

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
    const admin = createAdminSupabaseClient()

    let opdrachten = 0
    try {
      const { count } = await admin.from('opdrachten')
        .select('id', { count: 'exact', head: true })
        .in('status', OPEN_STATUSSEN)
        .lt('deadline', vandaagISO())
      opdrachten = count ?? 0
    } catch { /* tabel nog niet gemigreerd → geen bolletje */ }

    return NextResponse.json({ opdrachten })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
