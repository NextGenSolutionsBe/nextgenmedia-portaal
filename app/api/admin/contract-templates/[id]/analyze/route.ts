import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { analyzeContractPdf } from '@/lib/contract-ai'

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

    const { data: file } = await admin.storage.from('contracts').download(tpl.pdf_path)
    if (!file) return NextResponse.json({ error: 'PDF kon niet geladen worden.' }, { status: 400 })
    const base64 = Buffer.from(await file.arrayBuffer()).toString('base64')

    const analysis = await analyzeContractPdf(base64)
    const patch: Record<string, unknown> = { detected_fields: analysis.fields }
    if (analysis.signature) {
      patch.sig_page = analysis.signature.page
      patch.sig_x_pct = Math.max(0, Math.min(95, analysis.signature.x))
      patch.sig_y_pct = Math.max(0, Math.min(95, analysis.signature.y))
      patch.sig_width = analysis.signature.width
      patch.sig_height = analysis.signature.height
    }
    const p = { ...patch }
    for (let i = 0; i < 6; i++) {
      const { error } = await admin.from('contract_templates').update(p).eq('id', id)
      if (!error) break
      const col = String(error.message || '').match(/Could not find the '([^']+)' column/)?.[1]
      if (col && col in p) { delete p[col]; continue }
      throw new Error(error.message)
    }
    return NextResponse.json({ fields: analysis.fields, signature: analysis.signature })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
