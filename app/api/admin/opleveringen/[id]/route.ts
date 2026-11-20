import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { laadOpleveringen, wisBestanden } from '@/lib/opleveringen-server'
import { soortVan } from '@/lib/opleveringen'

export const dynamic = 'force-dynamic'
const isUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v)

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('opleveringen', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 })
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Onbekende oplevering.' }, { status: 400 })
    const [o] = await laadOpleveringen(createAdminSupabaseClient(), { id })
    if (!o) return NextResponse.json({ error: 'Oplevering niet gevonden.' }, { status: 404 })
    return NextResponse.json({ oplevering: o }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'oplevering.GET') }, { status: 500 }) }
}

/** PATCH { titel?, soort?, omschrijving?, opdracht_id?, max_revisies?, extra_ronde?, archiveer? } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('opleveringen', 'aanpassen'))) return NextResponse.json({ error: 'Je mag dit niet aanpassen.' }, { status: 403 })
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Onbekende oplevering.' }, { status: 400 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const { data: o } = await admin.from('opleveringen').select('max_revisies').eq('id', id).maybeSingle()
    if (!o) return NextResponse.json({ error: 'Oplevering niet gevonden.' }, { status: 404 })
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if ('titel' in b) {
      const t = String(b.titel ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
      if (!t) return NextResponse.json({ error: 'De titel mag niet leeg zijn.' }, { status: 400 })
      patch.titel = t
    }
    if ('soort' in b) patch.soort = soortVan(b.soort)
    if ('omschrijving' in b) patch.omschrijving = String(b.omschrijving ?? '').trim().slice(0, 4000) || null
    if ('opdracht_id' in b) patch.opdracht_id = isUuid(String(b.opdracht_id ?? '')) ? String(b.opdracht_id) : null
    if ('max_revisies' in b && Number.isInteger(Number(b.max_revisies))) patch.max_revisies = Math.max(0, Math.min(10, Number(b.max_revisies)))
    if (b.extra_ronde === true) patch.max_revisies = Math.min(10, Number((o as { max_revisies: number }).max_revisies) + 1)
    if ('archiveer' in b) patch.gearchiveerd_op = b.archiveer ? new Date().toISOString() : null
    const { error } = await admin.from('opleveringen').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'oplevering.PATCH') }, { status: 500 }) }
}

/** DELETE — oplevering met alle versies, feedback en bestanden weg. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('opleveringen', 'verwijderen'))) return NextResponse.json({ error: 'Je mag opleveringen niet verwijderen.' }, { status: 403 })
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Onbekende oplevering.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    await wisBestanden(admin, { oplevering_id: id })
    const { error } = await admin.from('opleveringen').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'oplevering.DELETE') }, { status: 500 }) }
}
