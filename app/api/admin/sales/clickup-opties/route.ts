import { safeMessage } from '@/lib/api-error'
import { NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/supabase/server'
import { listClickupMembers, listAlleLijsten, clickupConfigured } from '@/lib/clickup'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Keuzelijsten voor de ClickUp-koppeling van de verkoopmodule:
 *  · leden  — wie wordt toegewezen op afspraaktaken (Bram, Marco, …)
 *  · lijsten — in welke ClickUp-lijst de afspraaktaken van een merk komen
 *
 * ADMIN-ONLY: dit toont de complete structuur van de ClickUp-werkruimte
 * (alle spaces, mappen, lijsten en teamleden). Dat is beheersinformatie —
 * agenda's koppelen en merkinstellingen zetten is sowieso beheerderswerk.
 *
 * Beide rechtstreeks uit ClickUp, zodat er nooit een verouderde kopie in de
 * app leeft. `ingesteld` vertelt de UI het verschil tussen "geen lijsten" en
 * "de koppeling ontbreekt of hapert".
 */
export async function GET() {
  try {
    if (!(await requireAdmin())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const [leden, lijsten] = await Promise.all([listClickupMembers(), listAlleLijsten()])
    return NextResponse.json({
      ingesteld: clickupConfigured(),
      leden: leden.map((m) => ({ id: m.id, naam: m.username || m.email })),
      lijsten,
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
