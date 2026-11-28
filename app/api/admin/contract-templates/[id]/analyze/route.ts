import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { analyseerVelden } from '@/lib/contracten/velden-analyse-server'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

export const maxDuration = 60

// POST /api/admin/contract-templates/[id]/analyze — AI detecteert velden + handtekeningzone.
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin' && !(await isActiveStaff(user.id))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const admin = createAdminSupabaseClient()
    const { data: tpl } = await admin.from('contract_templates').select('*').eq('id', id).maybeSingle()
    if (!tpl) return NextResponse.json({ error: 'Template niet gevonden' }, { status: 404 })
    if (!tpl.pdf_path) return NextResponse.json({ error: 'Geen PDF gekoppeld aan deze template.' }, { status: 400 })

    // AI zoekt de velden, de pdf zelf zet ze recht (lijnen, vakjes, kaders).
    const analysis = await analyseerVelden(admin, 'contract_templates', tpl)
    return NextResponse.json({ fields: analysis.fields, signature: analysis.signature, ons: analysis.ons, uitgelijnd: analysis.uitgelijnd })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
