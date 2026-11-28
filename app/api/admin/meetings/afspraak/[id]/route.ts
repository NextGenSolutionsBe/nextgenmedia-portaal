import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { plannerRechten } from '@/lib/meetings/rechten'
import { afspraakHerinneringBijwerken, afspraakHerinneringOpnieuw } from '@/lib/meetings/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

/**
 * Herinnering van een verkoopafspraak (Calendar) vanuit de Meeting Inplanner.
 * Bewerken, verplaatsen en annuleren van de afspraak zelf blijven bij de
 * bestaande afspraak-API (/api/admin/sales/appointments).
 *  PATCH { actie: 'herinnering_opnieuw' | 'herinnering_plannen' }
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const r = await plannerRechten()
    if (!r.persoon || !r.verkoop.aanpassen) return NextResponse.json({ error: 'Je mag verkoopafspraken niet aanpassen' }, { status: 403 })
    if (!UUID.test(params.id)) return NextResponse.json({ error: 'Afspraak niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    const { data: a } = await admin.from('sales_appointments').select('id, status').eq('id', params.id).maybeSingle()
    if (!a) return NextResponse.json({ error: 'Afspraak niet gevonden' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as { actie?: string }
    const { ip, userAgent } = requestMeta(req)
    if (b.actie === 'herinnering_opnieuw') {
      const res = await afspraakHerinneringOpnieuw(admin, params.id)
      await logAudit({ action: 'afspraak.herinnering_opnieuw', entityType: 'sales_appointment', entityId: params.id, actorUserId: user.id, actorEmail: r.persoon.email, ip, userAgent, metadata: { uitkomst: res.uitkomst ?? null } })
      if (!res.ok) return NextResponse.json({ error: res.fout ?? 'Versturen mislukt' }, { status: 400 })
      return NextResponse.json({ ok: true, uitkomst: res.uitkomst })
    }
    if (b.actie === 'herinnering_plannen') {
      await afspraakHerinneringBijwerken(admin, params.id)
      return NextResponse.json({ ok: true })
    }
    return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err, 'meetings.afspraak.PATCH') }, { status: 500 })
  }
}
