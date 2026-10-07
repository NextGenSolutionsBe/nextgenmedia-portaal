import { NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { canonicalStatus, statusInfo } from '@/lib/contract-status'
import { leesInstellingen } from '@/lib/instellingen/laden'

export const dynamic = 'force-dynamic'

/** Keuzelijsten voor de factuureditor en de invoerstappen: klanten, contracten en de standaardwaarden. */
export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const [{ data: klanten }, { data: contracten }, inst] = await Promise.all([
      admin.from('clients').select('id, company_name, btw_nummer').is('archived_at', null).order('company_name'),
      admin.from('contracts').select('id, title, status, client_id, created_at').neq('status', 'template').order('created_at', { ascending: false }).limit(400),
      leesInstellingen(),
    ])
    return NextResponse.json({
      klanten: ((klanten ?? []) as { id: string; company_name: string | null; btw_nummer: string | null }[]).map((k) => ({ id: k.id, naam: k.company_name ?? '(zonder naam)', btw: k.btw_nummer ?? null })),
      contracten: ((contracten ?? []) as { id: string; title: string | null; status: string | null; client_id: string | null }[])
        .map((c) => ({ id: c.id, titel: c.title ?? '(zonder titel)', status: canonicalStatus(c.status), label: statusInfo(c.status).label, client_id: c.client_id })),
      instellingen: {
        standaard_btw_pct: inst.facturatie.standaard_btw_pct, betalingstermijn_dagen: inst.facturatie.betalingstermijn_dagen,
        km_tarief_excl: inst.facturatie.km_tarief_excl ?? 0, km_btw_pct: inst.facturatie.km_btw_pct ?? 21,
      },
    })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
