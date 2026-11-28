import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'

export const dynamic = 'force-dynamic'

/** POST { is_finaal? } — nieuwe (lege) versie. Er staat altijd hoogstens één concept-versie open. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('opleveringen', 'toevoegen'))) return NextResponse.json({ error: 'Je mag geen versies toevoegen.' }, { status: 403 })
    const { id } = await params
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Onbekende oplevering.' }, { status: 400 })
    const b = await req.json().catch(() => ({})) as { is_finaal?: unknown }
    const admin = createAdminSupabaseClient()
    const { data: vs } = await admin.from('oplevering_versies').select('id, nummer, gepubliceerd_op').eq('oplevering_id', id).order('nummer', { ascending: false })
    const lijst = (vs ?? []) as { id: string; nummer: number; gepubliceerd_op: string | null }[]
    const concept = lijst.find((v) => !v.gepubliceerd_op)
    if (concept) return NextResponse.json({ id: concept.id, bestond: true })
    const { data, error } = await admin.from('oplevering_versies').insert({ oplevering_id: id, nummer: (lijst[0]?.nummer ?? 0) + 1, is_finaal: b.is_finaal === true }).select('id').single()
    if (error) throw new Error(error.message)
    await admin.from('opleveringen').update({ updated_at: new Date().toISOString() }).eq('id', id)
    return NextResponse.json({ id: (data as { id: string }).id })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'oplevering.versie.POST') }, { status: 500 }) }
}
