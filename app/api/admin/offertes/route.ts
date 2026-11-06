import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { maakOfferte, offertesLijst, sjablonen, publiekeLink } from '@/lib/offertes-server'
import { fout } from './_fout'

export const dynamic = 'force-dynamic'

/**
 * Offertes.
 *  GET                       → alle offertes (?opdracht_id= of ?client_id= voor één project of klant)
 *  GET ?sjablonen=1          → de actieve sjablonen (voor "Stuur offerte")
 *  POST                      → nieuwe offerte (concept): { titel, bedrag_excl?, geldig_tot?, merk, sjabloon_id | eigen_pad, client_id | klant_naam, opdracht_id? }
 * Versturen gebeurt daarna via de MailComposer (/api/admin/offertes/<id>/send-mail).
 * Toegang: module Offertes, Projecten of Klanten (middleware) + teamlid.
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    const sp = req.nextUrl.searchParams
    if (sp.get('sjablonen') === '1') return NextResponse.json({ sjablonen: await sjablonen(admin) })
    const lijst = await offertesLijst(admin, { opdracht_id: sp.get('opdracht_id') ?? undefined, client_id: sp.get('client_id') ?? undefined })
    return NextResponse.json({ offertes: lijst.map((o) => ({ ...o, link: publiekeLink(o) })) })
  } catch (e) { return fout(e, 'offertes.GET') }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const admin = createAdminSupabaseClient()
    const o = await maakOfferte(admin, b, { userId: user.id, email: user.email ?? null })
    const meta = requestMeta(req)
    await logAudit({ action: 'offerte.aangemaakt', entityType: 'offerte', entityId: o.id, summary: `Offerte "${o.titel}" voor ${o.klant_naam ?? '?'} (concept)`, actorUserId: user.id, actorEmail: user.email ?? null, ip: meta.ip, userAgent: meta.userAgent })
    return NextResponse.json({ offerte: { ...o, link: publiekeLink(o) } })
  } catch (e) { return fout(e, 'offertes.POST') }
}
