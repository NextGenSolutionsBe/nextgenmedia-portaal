import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { publiekeLink } from '@/lib/offertes-server'
import { maakOpgemaakteOfferte, offerteContacten, volgendNummer } from '@/lib/offertes-opmaak-server'
import { fout } from '../_fout'

export const dynamic = 'force-dynamic'

/**
 * Offerte opmaken in de app.
 *  GET  → wat het formulier nodig heeft: het volgende offertenummer en de contacten per verantwoordelijke.
 *  POST → nieuwe offerte (concept) uit de invulfiches: { client_id | klant_naam, opdracht_id?, merk, verantwoordelijke, inhoud }.
 * Versturen gebeurt daarna via de MailComposer, zoals elke offerte.
 */
export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const [nummer, contacten] = await Promise.all([volgendNummer(admin), offerteContacten(admin)])
    return NextResponse.json({ volgend_nummer: nummer, contacten }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return fout(e, 'offertes.opmaken.GET') }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const o = await maakOpgemaakteOfferte(createAdminSupabaseClient(), b, { userId: user.id, email: user.email ?? null })
    await logAudit({ action: 'offerte.opgemaakt', entityType: 'offerte', entityId: o.id, summary: `Offerte ${o.offertenummer ?? ''} "${o.titel}" opgemaakt voor ${o.klant_naam ?? '?'} (concept)`, actorUserId: user.id, actorEmail: user.email ?? null, ...requestMeta(req) })
    return NextResponse.json({ offerte: { ...o, link: publiekeLink(o) } })
  } catch (e) { return fout(e, 'offertes.opmaken.POST') }
}
