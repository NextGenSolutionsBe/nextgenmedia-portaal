import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisTeamLid } from '@/lib/personeel/server'

export const dynamic = 'force-dynamic'

/** GET — de eigen meldingen. PATCH { gelezen: 'alles' | id } — als gelezen markeren. */
export async function GET() {
  try {
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const { data } = await g.admin.from('personeel_meldingen').select('id, event, titel, tekst, link, gelezen_op, created_at').eq('personeel_id', g.lid.id).order('created_at', { ascending: false }).limit(100)
    return NextResponse.json({ meldingen: data ?? [] })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const b = (await req.json().catch(() => ({}))) as { gelezen?: string }
    let q = g.admin.from('personeel_meldingen').update({ gelezen_op: new Date().toISOString() }).eq('personeel_id', g.lid.id).is('gelezen_op', null)
    if (b.gelezen && b.gelezen !== 'alles') q = q.eq('id', b.gelezen)
    await q
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
