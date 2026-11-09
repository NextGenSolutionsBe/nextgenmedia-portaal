import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { magIk } from '@/lib/instellingen/laden'
import { leesOfferte, trekIn, verwijderOfferte, publiekeLink } from '@/lib/offertes-server'
import { fout } from '../_fout'

export const dynamic = 'force-dynamic'

/** Eén offerte: GET (met tijdlijn), PATCH { actie: 'intrekken' }, DELETE (volledig verwijderen, elke status; recht offertes/verwijderen). */
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

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const persoon = await magIk('offertes', 'verwijderen')
    if (!persoon) return NextResponse.json({ error: 'Je mag offertes niet verwijderen.' }, { status: 403 })
    const { id } = await params
    const r = await verwijderOfferte(createAdminSupabaseClient(), id, persoon.naam ?? persoon.email ?? null)
    await logAudit({ action: 'offerte.verwijderd', entityType: 'offerte', entityId: id, summary: `Offerte "${r.titel}"${r.klant ? ` (${r.klant})` : ''} verwijderd, status was ${r.status}`, actorUserId: persoon.userId, actorEmail: persoon.email, ...requestMeta(req) })
    return NextResponse.json({ ok: true })
  } catch (e) { return fout(e, 'offerte.DELETE') }
}
