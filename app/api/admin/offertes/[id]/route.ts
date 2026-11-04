import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit } from '@/lib/audit'
import { leesOfferte, trekIn, verwijderConcept, publiekeLink } from '@/lib/offertes-server'
import { fout } from '../_fout'

export const dynamic = 'force-dynamic'

/** Eén offerte: GET (met tijdlijn), PATCH { actie: 'intrekken' }, DELETE (enkel een concept). */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const o = await leesOfferte(admin, id)
    if (!o) return NextResponse.json({ error: 'Offerte niet gevonden.' }, { status: 404 })
    const { data: events } = await admin.from('offerte_events').select('soort, meta, created_at').eq('offerte_id', id).order('created_at', { ascending: false }).limit(50)
    return NextResponse.json({ offerte: { ...o, link: publiekeLink(o) }, events: events ?? [] })
  } catch (e) { return fout(e, 'offerte.GET') }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const b = await req.json().catch(() => ({})) as { actie?: unknown }
    if (b.actie !== 'intrekken') return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
    await trekIn(createAdminSupabaseClient(), id, user.email ?? null)
    await logAudit({ action: 'offerte.ingetrokken', entityType: 'offerte', entityId: id, summary: 'Offerte ingetrokken', actorUserId: user.id, actorEmail: user.email ?? null })
    return NextResponse.json({ ok: true })
  } catch (e) { return fout(e, 'offerte.PATCH') }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    await verwijderConcept(createAdminSupabaseClient(), id)
    await logAudit({ action: 'offerte.concept_verwijderd', entityType: 'offerte', entityId: id, summary: 'Concept-offerte verwijderd', actorUserId: user.id, actorEmail: user.email ?? null })
    return NextResponse.json({ ok: true })
  } catch (e) { return fout(e, 'offerte.DELETE') }
}
