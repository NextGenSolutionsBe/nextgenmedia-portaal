import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { NIET_MEETELLEN_SLEUTEL } from '@/lib/vesting-snel'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Een getekend contract dat niet voor Vesting telt (Marco was niet betrokken)
 * uit de lijst "Te beoordelen" halen, of terugzetten. Bewaard als lijst van
 * contract-id's in app_settings; het contract zelf verandert niet.
 */
export async function POST(req: NextRequest) {
  const actor = await requireAdmin()
  if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
  try {
    const b = (await req.json().catch(() => ({}))) as { contract_id?: unknown; actie?: unknown }
    const id = typeof b.contract_id === 'string' && UUID.test(b.contract_id) ? b.contract_id : null
    if (!id || (b.actie !== 'telt_niet' && b.actie !== 'herstel')) return NextResponse.json({ error: 'Ongeldige vraag.' }, { status: 400 })
    const admin = createAdminSupabaseClient()
    const { data: c } = await admin.from('contracts').select('id, title').eq('id', id).maybeSingle()
    if (!c) return NextResponse.json({ error: 'Contract niet gevonden.' }, { status: 404 })
    const { data: rij } = await admin.from('app_settings').select('value').eq('key', NIET_MEETELLEN_SLEUTEL).maybeSingle()
    const huidig = new Set<string>(Array.isArray((rij?.value as { ids?: unknown } | null)?.ids) ? ((rij!.value as { ids: unknown[] }).ids.filter((x) => typeof x === 'string') as string[]) : [])
    if (b.actie === 'telt_niet') huidig.add(id); else huidig.delete(id)
    const nu = new Date().toISOString()
    const { error } = await admin.from('app_settings').upsert({ key: NIET_MEETELLEN_SLEUTEL, value: { ids: [...huidig] }, updated_at: nu, updated_by_email: actor.email ?? null }, { onConflict: 'key' })
    if (error) throw new Error(error.message)
    const meta = requestMeta(req)
    await logAudit({
      action: b.actie === 'telt_niet' ? 'vesting.telt_niet' : 'vesting.telt_niet_herstel', entityType: 'contract', entityId: id,
      summary: `Vesting: "${(c as { title: string }).title}" ${b.actie === 'telt_niet' ? 'telt niet mee' : 'weer te beoordelen'}`,
      actorUserId: actor.id, actorEmail: actor.email ?? null, actorRole: 'admin', ip: meta.ip, userAgent: meta.userAgent,
    })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: safeMessage(e, 'Bewaren mislukt') }, { status: 500 })
  }
}
