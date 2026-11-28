import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { analyseerVelden } from '@/lib/contracten/velden-analyse-server'
import { logContractEvent } from '@/lib/contract-audit'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

export const maxDuration = 60

// POST /api/admin/contracts/[id]/analyze — AI detecteert invulvelden + handtekeningzone, de pdf zet ze exact (velden-uitlijnen).
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin' && !(await isActiveStaff(user.id))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const admin = createAdminSupabaseClient()
    const { data: contract } = await admin.from('contracts').select('*').eq('id', id).maybeSingle()
    if (!contract) return NextResponse.json({ error: 'Contract niet gevonden' }, { status: 404 })
    if (!contract.pdf_path) return NextResponse.json({ error: 'Geen PDF gekoppeld aan dit contract.' }, { status: 400 })

    // Vanzelf (na het opladen, VeldenZoeken): nooit iets overschrijven dat iemand al instelde.
    const vanzelf = req.nextUrl.searchParams.get('vanzelf') === '1'
    if (vanzelf && Array.isArray(contract.detected_fields) && contract.detected_fields.length) return NextResponse.json({ fields: contract.detected_fields, signature: null, ons: null, uitgelijnd: false, al: true })
    const standaardZone = (contract.sig_page ?? 1) === 1 && Number(contract.sig_x_pct ?? 5) === 5 && Number(contract.sig_y_pct ?? 25) === 25 && Number(contract.sig_width ?? 200) === 200 && Number(contract.sig_height ?? 60) === 60

    // AI zoekt de velden, de pdf zelf zet ze recht (lijnen, vakjes, kaders).
    const analysis = await analyseerVelden(admin, 'contracts', contract, { zoneVast: vanzelf && !standaardZone })

    await logContractEvent(admin, id, 'ai_analyzed', { actor: user.email ?? user.id, meta: { fields: analysis.fields.length, signature: !!analysis.signature, uitgelijnd: analysis.uitgelijnd } })
    return NextResponse.json({ fields: analysis.fields, signature: analysis.signature, ons: analysis.ons, uitgelijnd: analysis.uitgelijnd })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
