import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { planFacturenUitContract } from '@/lib/facturatie/contract-plan-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

const UUID = /^[0-9a-f-]{36}$/i

/**
 * Facturen uit het getekende contract.
 *  GET  → de laatste poging (gepland, onvolledig of fout) en of er al facturen zijn.
 *  POST → nu (opnieuw) plannen. Nooit dubbels: heeft het contract al facturen,
 *         dan gebeurt er niets.
 * Rechten: contracts.bekijken (GET), contracts.aanpassen (POST).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('contracts', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const [{ data: log }, { count }] = await Promise.all([
      admin.from('contract_facturatie_log').select('sync_status, fout, details, created_at').eq('contract_id', id).eq('gebeurtenis', 'facturen_plannen').order('created_at', { ascending: false }).limit(1).maybeSingle(),
      admin.from('invoices').select('id', { count: 'exact', head: true }).eq('contract_id', id).not('status', 'in', '(geannuleerd,gecrediteerd)'),
    ])
    return NextResponse.json({ laatste: log ?? null, facturen: count ?? 0 })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await magIk('contracts', 'aanpassen')
    if (!actor) return NextResponse.json({ error: 'Je hebt geen recht om facturen aan een contract toe te voegen.' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const r = await planFacturenUitContract(createAdminSupabaseClient(), id, { door: actor.email ?? null, userId: actor.userId })
    return NextResponse.json(r)
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
