import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { leesPersoon, magIk } from '@/lib/instellingen/laden'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { leesDoelen } from '@/lib/financieel/fase7'

export const dynamic = 'force-dynamic'
const SLEUTEL = 'maanddoelen'

/**
 * Maanddoelen van de facturenplanner (verbeterplan fase 7, punt 79): het doel
 * van nu, de ambitie (€ 100.000 per maand) en optioneel een doel per bedrijf.
 * GET: wie Facturen mag zien. POST: enkel de zaakvoerders.
 */
export async function GET() {
  try {
    const p = await magIk('invoices', 'bekijken')
    if (!p) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { data } = await createAdminSupabaseClient().from('app_settings').select('value').eq('key', SLEUTEL).maybeSingle()
    return NextResponse.json({ doelen: leesDoelen(data?.value), kanAanpassen: !!p.isAdmin })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 400 }) }
}

export async function POST(req: NextRequest) {
  try {
    const p = await leesPersoon()
    if (!p?.isAdmin) return NextResponse.json({ error: 'Enkel de zaakvoerders passen de maanddoelen aan.' }, { status: 403 })
    const doelen = leesDoelen(await req.json().catch(() => ({})))
    const { error } = await createAdminSupabaseClient().from('app_settings').upsert({ key: SLEUTEL, value: doelen, updated_at: new Date().toISOString(), updated_by_email: p.email }, { onConflict: 'key' })
    if (error) throw new Error(error.message)
    await logAudit({ action: 'maanddoel.wijzig', entityType: 'instellingen', entityId: SLEUTEL, summary: 'Maanddoelen aangepast', actorUserId: p.userId, actorEmail: p.email, metadata: doelen, ...requestMeta(req) })
    return NextResponse.json({ doelen })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 400 }) }
}
