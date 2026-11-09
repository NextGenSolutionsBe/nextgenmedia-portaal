import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { logAudit, requestMeta } from '@/lib/audit'
import { bewaarOfferteInstellingen, offerteContacten, offerteInstellingen } from '@/lib/offertes-opmaak-server'
import { fout } from '../_fout'

export const dynamic = 'force-dynamic'

/** De betalingstermijn op de offerte (PUT: recht offertes/instellingen) en, ter info, de contactpersonen zoals Personeel ze heeft. */
export async function GET() {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const mag = !!(await magIk('offertes', 'instellingen'))
    const admin = createAdminSupabaseClient()
    const [instellingen, contacten] = await Promise.all([offerteInstellingen(admin), offerteContacten(admin)])
    return NextResponse.json({ instellingen, contacten, mag_aanpassen: mag })
  } catch (e) { return fout(e, 'offertes.instellingen.GET') }
}

export async function PUT(req: NextRequest) {
  try {
    const persoon = await magIk('offertes', 'instellingen')
    if (!persoon) return NextResponse.json({ error: 'Je mag de instellingen van offertes niet aanpassen.' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const v = await bewaarOfferteInstellingen(createAdminSupabaseClient(), b, persoon.email ?? null)
    await logAudit({ action: 'offerte.instellingen', entityType: 'instellingen', entityId: 'offerte_instellingen', summary: 'Betalingstermijn van offertes aangepast', actorUserId: persoon.userId, actorEmail: persoon.email, ...requestMeta(req) })
    return NextResponse.json({ instellingen: v })
  } catch (e) { return fout(e, 'offertes.instellingen.PUT') }
}
