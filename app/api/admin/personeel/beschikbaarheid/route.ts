import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, audit } from '@/lib/personeel/server'
import { voegBeschikbaarheidToe } from '@/lib/personeel/beschikbaarheid-server'
import { dagOf, uuidOf } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/** POST { personeel_id, datum, start, eind } — beschikbaarheid invullen voor een medewerker. */
export async function POST(req: NextRequest) {
  try {
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const pid = uuidOf(b.personeel_id), datum = dagOf(b.datum)
    if (!pid || !datum) return NextResponse.json({ error: 'Kies een medewerker en een dag.' }, { status: 400 })
    const r = await voegBeschikbaarheidToe(g.admin, { personeelId: pid, datum, start: String(b.start ?? ''), eind: String(b.eind ?? '') })
    if (!r.ok) return NextResponse.json({ error: r.fout }, { status: r.status })
    await audit(g.admin, { personeel_id: pid, entiteit: 'beschikbaarheid', entiteit_id: r.id ?? '', actie: 'beschikbaarheid_ingediend', nieuw: { datum, start: b.start, eind: b.eind, door_admin: true }, actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true, id: r.id })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
