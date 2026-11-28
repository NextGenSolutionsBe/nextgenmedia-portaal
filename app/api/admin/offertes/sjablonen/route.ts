import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logAudit, requestMeta } from '@/lib/audit'
import { sjablonen, bewaarSjabloon, verwijderSjabloon } from '@/lib/offertes-server'
import { fout } from '../_fout'

export const dynamic = 'force-dynamic'

/**
 * Offertesjablonen: de achterliggende pdf's (offerte reel, website …).
 *  GET → alle sjablonen (ook uitgezette) · POST → nieuw of bijwerken ({ id? , naam, merk, dienst?, beschrijving?, pdf_pad?, pdf_naam?, actief? })
 *  DELETE ?id= → weg (verstuurde offertes houden hun eigen kopie).
 */
export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    return NextResponse.json({ sjablonen: await sjablonen(createAdminSupabaseClient(), true) })
  } catch (e) { return fout(e, 'sjablonen.GET') }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const s = await bewaarSjabloon(createAdminSupabaseClient(), b, user.email ?? null)
    const meta = requestMeta(req)
    await logAudit({ action: b.id ? 'offerte.sjabloon_gewijzigd' : 'offerte.sjabloon_aangemaakt', entityType: 'offerte_sjabloon', entityId: s.id, summary: `Offertesjabloon "${s.naam}"${b.pdf_pad ? ' (nieuwe pdf)' : ''}`, actorUserId: user.id, actorEmail: user.email ?? null, ip: meta.ip, userAgent: meta.userAgent })
    return NextResponse.json({ sjabloon: s })
  } catch (e) { return fout(e, 'sjablonen.POST') }
}

export async function DELETE(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('id') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Sjabloon niet gevonden.' }, { status: 404 })
    await verwijderSjabloon(createAdminSupabaseClient(), id)
    await logAudit({ action: 'offerte.sjabloon_verwijderd', entityType: 'offerte_sjabloon', entityId: id, summary: 'Offertesjabloon verwijderd', actorUserId: user.id, actorEmail: user.email ?? null })
    return NextResponse.json({ ok: true })
  } catch (e) { return fout(e, 'sjablonen.DELETE') }
}
