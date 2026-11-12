import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { laadStatistieken, leesPeriode } from '@/lib/sales/statistieken-data'
import { isLeadbron } from '@/lib/sales/leadbron'
import { bouwAccounts, type TrendPer } from '@/lib/sales/statistieken'

export const dynamic = 'force-dynamic'

/**
 * Salesstatistieken (activiteiten per medewerker en voor het team).
 *
 * GET ?van=JJJJ-MM-DD&tot=JJJJ-MM-DD[&medewerker=<auth-id>][&richting=inbound|outbound]
 *     [&dienst=…][&leadbron=…][&trend=dag|week|maand]
 *
 * WIE ZIET WAT. Een admin ziet iedereen; een setter/werknemer ziet ALLEEN
 * zichzelf. Dat wordt hier afgedwongen en niet in het scherm.
 */
export async function GET(req: NextRequest) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const isAdmin = !!(await requireAdmin())

    const sp = req.nextUrl.searchParams
    const periode = leesPeriode(sp.get('van'), sp.get('tot'))
    const richtingRuw = sp.get('richting')
    const richting = richtingRuw === 'inbound' || richtingRuw === 'outbound' ? richtingRuw : undefined
    const dienst = sp.get('dienst')?.trim() || undefined
    const leadbronRuw = sp.get('leadbron')?.trim() || ''
    const leadbron = isLeadbron(leadbronRuw) ? leadbronRuw : undefined
    const trendRuw = sp.get('trend')
    const trendPer: TrendPer | undefined = trendRuw === 'dag' || trendRuw === 'week' || trendRuw === 'maand' ? trendRuw : undefined

    const medewerkerId = isAdmin ? (sp.get('medewerker')?.trim() || undefined) : actor.id
    const uit = await laadStatistieken({ periode, medewerkerId, richting, dienst, leadbron, trendPer, accountsOverzicht: isAdmin })

    // Een setter ziet in de keuzelijst ook enkel zichzelf.
    const ik = { id: actor.id, naam: uit.medewerkers.find((m) => m.id === actor.id)?.naam ?? actor.email?.split('@')[0] ?? 'Ik' }
    const medewerkers = isAdmin
      ? (uit.medewerkers.some((m) => m.id === actor.id) ? uit.medewerkers : [...uit.medewerkers, ik])
      : [ik]
    // Zonder eigen rij (nog nergens in de lijst): toch één (lege) kaart voor jezelf.
    const accounts = !isAdmin && uit.accounts.length === 0
      ? bouwAccounts([], [ik], [], uit.metBeltijd)
      : uit.accounts

    return NextResponse.json({ ...uit, accounts, medewerkers, isAdmin, meId: actor.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
