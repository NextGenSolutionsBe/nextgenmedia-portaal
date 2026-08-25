import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { getOrCreateSetter, listSetters } from '@/lib/sales/setters'
import { laadStatistieken, leesPeriode } from '@/lib/sales/statistieken-data'

export const dynamic = 'force-dynamic'

/**
 * Cijfers van het appointment setten.
 *
 * WIE ZIET WAT. Een admin ziet iedereen; een setter ziet ALLEEN zichzelf. Dat
 * wordt hier afgedwongen en niet in het scherm — wie de knoppen in de browser
 * omzeilt, krijgt nog altijd enkel zijn eigen cijfers. Dezelfde regel als bij
 * /api/admin/sales/stats; die twee horen niet uit elkaar te lopen.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const isAdmin = !!(await requireAdmin())

    const sp = req.nextUrl.searchParams
    const periode = leesPeriode(sp.get('van'), sp.get('tot'))
    const sector = sp.get('sector')?.trim() || undefined

    if (!isAdmin) {
      const naam = actor.email?.split('@')[0] ?? 'Setter'
      const ik = await getOrCreateSetter(actor.id, naam, actor.email ?? null)
      if (!ik) return NextResponse.json({ error: 'Geen setterprofiel gevonden' }, { status: 403 })
      const uit = await laadStatistieken({ periode, sector, setterId: ik.id })
      // Ook de setterlijst beperken: anders lees je uit de keuzelijst af wie er
      // nog meer werkt, terwijl je hun cijfers niet mag zien.
      return NextResponse.json({
        ...uit,
        setters: uit.setters.filter((s) => s.id === ik.id),
        isAdmin: false,
        meId: ik.id,
      })
    }

    const gevraagd = sp.get('setter')?.trim() || ''
    const bestaat = gevraagd ? (await listSetters()).some((s) => s.id === gevraagd) : false
    const uit = await laadStatistieken({
      periode, sector, setterId: bestaat ? gevraagd : undefined,
    })
    return NextResponse.json({ ...uit, isAdmin: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
