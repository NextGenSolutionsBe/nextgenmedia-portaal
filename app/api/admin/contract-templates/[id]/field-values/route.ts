import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createClient, createAdminSupabaseClient , isActiveStaff } from '@/lib/supabase/server'
import { CONTRACT_FIELD_TYPES, type ContractField } from '@/lib/contract-ai'

// Gebruikt cookies/sessie: nooit statisch renderen.
export const dynamic = 'force-dynamic'

const VALID = new Set<string>(CONTRACT_FIELD_TYPES)

// PATCH — admin bewaart de (gecontroleerde) velddefinities van een template.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
    const { data: roleData } = await supabase.from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
    if (roleData?.role !== 'admin' && !(await isActiveStaff(user.id))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })

    const b = await req.json()
    if (!Array.isArray(b.detected_fields)) return NextResponse.json({ error: 'detected_fields vereist' }, { status: 400 })

    const fields: ContractField[] = (b.detected_fields as Record<string, unknown>[]).map((f) => {
      const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d }
      let type = String(f.type ?? 'text').toLowerCase(); if (!VALID.has(type)) type = 'text'
      return {
        label: String(f.label ?? '').slice(0, 120),
        type: type as ContractField['type'],
        page_number: Math.max(1, Math.round(num(f.page_number, 1))),
        x: Math.max(0, Math.min(100, num(f.x, 5))), y: Math.max(0, Math.min(100, num(f.y, 50))),
        width: Math.max(20, num(f.width, 180)), height: Math.max(12, num(f.height, 24)),
        required: !!f.required,
        placeholder: f.placeholder ? String(f.placeholder).slice(0, 120) : undefined,
        confidence: Number.isFinite(Number(f.confidence)) ? Math.max(0, Math.min(1, Number(f.confidence))) : undefined,
      }
    }).filter((f) => f.label)

    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('contract_templates').update({ detected_fields: fields }).eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true, fields })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
