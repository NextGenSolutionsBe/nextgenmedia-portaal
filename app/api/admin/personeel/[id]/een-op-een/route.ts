import { NextRequest, NextResponse } from 'next/server'
import { safeMessage } from '@/lib/api-error'
import { eisPersoneel, audit } from '@/lib/personeel/server'
import { isUuid } from '@/lib/personeel/invoer'
import { magEenOpEenZien, controleerActie, leesActies } from '@/lib/ritme/model'

export const dynamic = 'force-dynamic'

/**
 * 1-op-1's in het personeelsdossier (verbeterplan fase 7, punt 95): datum,
 * notities en afspraken. Zichtbaar voor de zaakvoerders, de medewerker zelf
 * (Mijn account) en wie het gesprek voerde. Verwijderen = verbergen.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('bekijken'); if (!g.ok) return g.response
    const { data, error } = await g.admin.from('een_op_een').select('*').eq('personeel_id', id).is('verwijderd_op', null).order('datum', { ascending: false }).limit(100)
    if (error) return NextResponse.json({ gesprekken: [], fout: '1-op-1\'s zijn nog niet beschikbaar (migratie).' })
    const ik = { isAdmin: g.persoon.isAdmin, userId: g.persoon.userId }
    return NextResponse.json({ gesprekken: ((data ?? []) as { medewerker_user_id: string | null; met_user_id: string | null }[]).filter((r) => magEenOpEenZien(ik, r)).map((r) => ({ ...r, afspraken: leesActies((r as { afspraken?: unknown }).afspraken) })) })
  } catch (err) { return NextResponse.json({ error: safeMessage(err) }, { status: 400 }) }
}

/** POST { datum, notities, afspraken, id? } — nieuw gesprek of aanpassen; { id, weg: true } = verbergen. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!isUuid(id)) return NextResponse.json({ error: 'Ongeldig id' }, { status: 400 })
    const g = await eisPersoneel('aanpassen'); if (!g.ok) return g.response
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const { data: p } = await g.admin.from('personeel').select('auth_user_id').eq('id', id).maybeSingle()
    if (!p) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
    const nu = new Date().toISOString()
    if (typeof b.id === 'string' && isUuid(b.id)) {
      const { data: oud } = await g.admin.from('een_op_een').select('id, met_user_id, medewerker_user_id').eq('id', b.id).eq('personeel_id', id).maybeSingle()
      if (!oud || !magEenOpEenZien({ isAdmin: g.persoon.isAdmin, userId: g.persoon.userId }, oud)) return NextResponse.json({ error: 'Niet gevonden' }, { status: 404 })
      if (b.weg === true) {
        await g.admin.from('een_op_een').update({ verwijderd_op: nu }).eq('id', b.id)
        await audit(g.admin, { personeel_id: id, entiteit: 'een_op_een', actie: 'verborgen', oud: { id: b.id }, nieuw: null, actor_email: g.persoon.email, actor_id: g.persoon.userId })
        return NextResponse.json({ ok: true })
      }
    }
    const datum = typeof b.datum === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(b.datum) ? b.datum : null
    if (!datum) return NextResponse.json({ error: 'Kies de datum van het gesprek.' }, { status: 400 })
    const afspraken = (Array.isArray(b.afspraken) ? b.afspraken : []).flatMap((x) => { const c = controleerActie((x ?? {}) as Record<string, unknown>); return c.ok ? [{ id: typeof (x as { id?: unknown }).id === 'string' ? (x as { id: string }).id : crypto.randomUUID(), ...c.actie }] : [] }).slice(0, 30)
    const rij = { datum, notities: String(b.notities ?? '').slice(0, 20000) || null, afspraken, updated_at: nu }
    if (typeof b.id === 'string' && isUuid(b.id)) {
      const { error } = await g.admin.from('een_op_een').update(rij).eq('id', b.id)
      if (error) throw new Error(error.message)
      await audit(g.admin, { personeel_id: id, entiteit: 'een_op_een', actie: 'bijgewerkt', oud: null, nieuw: { id: b.id, datum }, actor_email: g.persoon.email, actor_id: g.persoon.userId })
      return NextResponse.json({ ok: true })
    }
    const { data, error } = await g.admin.from('een_op_een').insert({
      ...rij, personeel_id: id, medewerker_user_id: (p as { auth_user_id: string | null }).auth_user_id ?? null,
      met_user_id: g.persoon.userId, met_naam: g.persoon.naam ?? g.persoon.email,
    }).select('id').single()
    if (error) throw new Error(error.message)
    await audit(g.admin, { personeel_id: id, entiteit: 'een_op_een', actie: 'toegevoegd', oud: null, nieuw: { id: data.id, datum }, actor_email: g.persoon.email, actor_id: g.persoon.userId })
    return NextResponse.json({ ok: true, id: data.id })
  } catch (err) { return NextResponse.json({ error: safeMessage(err) }, { status: 400 }) }
}
