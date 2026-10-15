import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { requireStaff, requireAdmin } from '@/lib/supabase/server'
import { statsFor, monthPeriod, listSetters, getOrCreateSetter } from '@/lib/sales/setters'

export const dynamic = 'force-dynamic'

/**
 * Cijfers van de appointment setters.
 *
 * Een admin ziet iedereen; een setter ziet ALLEEN zichzelf. Dat wordt hier
 * afgedwongen en niet in het scherm: wie de rechten in de browser omzeilt,
 * krijgt nog altijd enkel zijn eigen cijfers terug.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const isAdmin = !!(await requireAdmin())

    const sp = req.nextUrl.searchParams
    const monthParam = sp.get('month')
    const base = monthParam ? new Date(`${monthParam}T12:00:00`) : new Date()
    const period = monthPeriod(Number.isFinite(base.getTime()) ? base : new Date())

    if (!isAdmin) {
      const name = actor.email?.split('@')[0] ?? 'Setter'
      const me = await getOrCreateSetter(actor.id, name, actor.email ?? null)
      if (!me) return NextResponse.json({ stats: [], isAdmin })
      const stats = await statsFor(period, me.id)
      return NextResponse.json({ stats, isAdmin, meId: me.id })
    }

    const wanted = sp.get('setter') ?? ''
    const valid = wanted ? (await listSetters()).some((s) => s.id === wanted) : false
    const stats = await statsFor(period, valid ? wanted : undefined)
    return NextResponse.json({ stats, isAdmin })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
