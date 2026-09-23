import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, leesMeldingInstellingen, audit } from '@/lib/personeel/server'
import { normaliseerMeldingInstellingen } from '@/lib/personeel/model'

export const dynamic = 'force-dynamic'

/** GET — meldingen voor de admins + de notificatie-instellingen. */
export async function GET() {
  try {
    const g = await eisPersoneel('bekijken'); if (!g.ok) return g.response
    const [{ data }, instellingen] = await Promise.all([
      g.admin.from('personeel_meldingen').select('*').is('personeel_id', null).order('created_at', { ascending: false }).limit(100),
      leesMeldingInstellingen(g.admin),
    ])
    return NextResponse.json({ meldingen: data ?? [], instellingen })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

/** PATCH { gelezen: 'alles' | id } — markeren als gelezen. PUT { instellingen } — notificaties instellen. */
export async function PATCH(req: NextRequest) {
  try {
    const g = await eisPersoneel('bekijken'); if (!g.ok) return g.response
    const b = (await req.json().catch(() => ({}))) as { gelezen?: string }
    let q = g.admin.from('personeel_meldingen').update({ gelezen_op: new Date().toISOString() }).is('personeel_id', null).is('gelezen_op', null)
    if (b.gelezen && b.gelezen !== 'alles') q = q.eq('id', b.gelezen)
    await q
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const g = await eisPersoneel('instellingen'); if (!g.ok) return g.response
    const b = (await req.json().catch(() => ({}))) as { instellingen?: unknown }
    const waarde = normaliseerMeldingInstellingen(b.instellingen)
    const oud = await leesMeldingInstellingen(g.admin)
    const { error } = await g.admin.from('app_settings').upsert({ key: 'personeel_meldingen', value: waarde, updated_at: new Date().toISOString(), updated_by_email: g.persoon.email }, { onConflict: 'key' })
    if (error) throw new Error(error.message)
    await audit(g.admin, { personeel_id: null, entiteit: 'instellingen', entiteit_id: 'personeel_meldingen', actie: 'notificaties_ingesteld', oud, nieuw: waarde, actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true, instellingen: waarde })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
