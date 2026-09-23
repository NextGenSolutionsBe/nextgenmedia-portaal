import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisTeamLid, audit, meld } from '@/lib/personeel/server'
import { isWerkstatus, WERKSTATUS } from '@/lib/personeel/model'
import { isUuid, tekst } from '@/lib/personeel/invoer'

export const dynamic = 'force-dynamic'

/** PATCH { werkstatus?, voortgang? } — de medewerker werkt de voortgang van een eigen werkblok bij. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisTeamLid(); if (!g.ok) return g.response
    const { data: p } = await g.admin.from('personeel_planning').select('id, werkstatus, voortgang, status, datum, taak').eq('id', id).eq('personeel_id', g.lid.id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Werkblok niet gevonden' }, { status: 404 })
    if (p.status === 'geannuleerd') return NextResponse.json({ error: 'Dit werkblok werd geannuleerd.' }, { status: 409 })
    const b = (await req.json().catch(() => ({}))) as { werkstatus?: string; voortgang?: string }
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (b.werkstatus !== undefined) { if (!isWerkstatus(b.werkstatus)) return NextResponse.json({ error: 'Onbekende status.' }, { status: 400 }); patch.werkstatus = b.werkstatus }
    if (b.voortgang !== undefined) patch.voortgang = tekst(b.voortgang, 5000)
    await g.admin.from('personeel_planning').update(patch).eq('id', id)
    await audit(g.admin, { personeel_id: g.lid.id, entiteit: 'planning', entiteit_id: id, actie: 'voortgang_bijgewerkt', oud: { werkstatus: p.werkstatus, voortgang: p.voortgang }, nieuw: patch, actor_email: g.lid.email, actor_id: g.lid.auth_user_id })
    if (patch.werkstatus && patch.werkstatus !== p.werkstatus && ['klaar_voor_controle', 'geblokkeerd'].includes(String(patch.werkstatus))) {
      const naam = [g.lid.voornaam, g.lid.achternaam].filter(Boolean).join(' ')
      await meld(g.admin, { personeel_id: null, event: 'uren_te_controleren', titel: `${WERKSTATUS[patch.werkstatus as keyof typeof WERKSTATUS].label} — ${naam}`, tekst: `${p.taak ?? 'Werkblok'} (${String(p.datum).split('-').reverse().join('/')}).${patch.voortgang ? ` ${patch.voortgang}` : ''}`, link: '/admin/personeel?tab=planning' })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
