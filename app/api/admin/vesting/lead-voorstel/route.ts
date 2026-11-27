import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { leadSoortVoorstel } from '@/lib/ngs/levering'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Voorstel voor "Inbound of outbound?" bij een contract (verbeterplan fase 5,
 * punt 31): uit het bedrijf van het contract en de bron en verantwoordelijke van
 * de projectkaart. Enkel lezen en voorstellen: aanduiden en tekenen blijft bij
 * de drie vennoten, de rekenregels van vesting veranderen niet.
 */
export async function GET(req: NextRequest) {
  const actor = await requireAdmin()
  if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const id = req.nextUrl.searchParams.get('contract')
    if (!id || !UUID.test(id)) return NextResponse.json({ voorstel: null })
    const admin = createAdminSupabaseClient()
    const [{ data: c }, { data: k }] = await Promise.all([
      admin.from('contracts').select('bedrijf').eq('id', id).maybeSingle(),
      admin.from('opdrachten').select('bron, verantwoordelijke, merk').eq('contract_id', id).maybeSingle(),
    ])
    const bedrijf = (c as { bedrijf?: string | null } | null)?.bedrijf ?? null
    const kaart = k as { bron?: string | null; verantwoordelijke?: string | null; merk?: string | null } | null
    const voorstel = leadSoortVoorstel(bedrijf ?? kaart?.merk ?? null, kaart?.bron ?? null, kaart?.verantwoordelijke ?? null)
    return NextResponse.json({ voorstel, bron: kaart?.bron ?? null, bedrijf, verantwoordelijke: kaart?.verantwoordelijke ?? null })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 400 }) }
}
