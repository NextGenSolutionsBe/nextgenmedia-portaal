import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { leesPersoon, magIk } from '@/lib/instellingen/laden'
import { logAudit, requestMeta } from '@/lib/audit'
import { safeMessage } from '@/lib/api-error'
import { klantWaardeVan, UURTARIEF_SLEUTEL } from '@/lib/financieel/fase7-server'

export const dynamic = 'force-dynamic'

/**
 * Klantwaarde en marge van één klant (verbeterplan fase 7). Enkel voor wie de
 * financiën mag zien. POST { uurtarief }: het interne uurtarief (zaakvoerders).
 */
export async function GET(req: NextRequest) {
  try {
    if (!(await magIk('finance', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const id = req.nextUrl.searchParams.get('client_id') ?? ''
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: 'Onbekende klant' }, { status: 400 })
    const p = await leesPersoon()
    return NextResponse.json({ waarde: await klantWaardeVan(createAdminSupabaseClient(), id), kanTarief: !!p?.isAdmin })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 400 }) }
}

export async function POST(req: NextRequest) {
  try {
    const p = await leesPersoon()
    if (!p?.isAdmin) return NextResponse.json({ error: 'Enkel de zaakvoerders zetten het uurtarief.' }, { status: 403 })
    const b = (await req.json().catch(() => ({}))) as { uurtarief?: unknown }
    const n = Number(String(b.uurtarief ?? '').replace(',', '.'))
    const tarief = Number.isFinite(n) && n > 0 && n < 1000 ? Math.round(n * 100) / 100 : null
    const { error } = await createAdminSupabaseClient().from('app_settings').upsert({ key: UURTARIEF_SLEUTEL, value: { tarief }, updated_at: new Date().toISOString(), updated_by_email: p.email }, { onConflict: 'key' })
    if (error) throw new Error(error.message)
    await logAudit({ action: 'uurtarief.wijzig', entityType: 'instellingen', entityId: UURTARIEF_SLEUTEL, summary: tarief ? `Intern uurtarief: € ${tarief}` : 'Intern uurtarief weggehaald', actorUserId: p.userId, actorEmail: p.email, ...requestMeta(req) })
    return NextResponse.json({ uurtarief: tarief })
  } catch (e) { return NextResponse.json({ error: safeMessage(e) }, { status: 400 }) }
}
