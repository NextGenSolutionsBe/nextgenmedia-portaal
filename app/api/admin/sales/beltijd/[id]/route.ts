import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin, requireStaff } from '@/lib/supabase/server'
import { BELTIJD_KOLOMMEN, BELTIJD_MIGRATIE_NODIG, isBeltijdTabelFout } from '@/lib/sales/beltijd-data'
import { MAX_HANDMATIG_MINUTEN, brusselNaarUtc, type BeltijdSessie } from '@/lib/sales/beltijd'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

/** Enkel je eigen sessies; een admin mag die van iedereen aanpassen. */
async function magBewerken(id: string): Promise<{ ok: true; rij: BeltijdSessie } | { ok: false; response: NextResponse }> {
  const actor = await requireStaff()
  if (!actor) return { ok: false, response: NextResponse.json({ error: 'Geen toegang' }, { status: 403 }) }
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin.from('sales_beltijd').select(BELTIJD_KOLOMMEN)
    .eq('id', id).is('verwijderd_op', null).maybeSingle()
  if (error) {
    if (isBeltijdTabelFout(error.message)) return { ok: false, response: NextResponse.json({ error: BELTIJD_MIGRATIE_NODIG }, { status: 503 }) }
    throw new Error(error.message)
  }
  if (!data) return { ok: false, response: NextResponse.json({ error: 'Sessie niet gevonden' }, { status: 404 }) }
  const rij = data as BeltijdSessie
  if (rij.medewerker_id !== actor.id && !(await requireAdmin())) {
    return { ok: false, response: NextResponse.json({ error: 'Enkel je eigen beltijd kan je aanpassen.' }, { status: 403 }) }
  }
  return { ok: true, rij }
}

// PATCH { duurMinuten?, datum?, tijd?, notitie? } — duur/start enkel voor een afgesloten sessie.
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const g = await magBewerken(id)
    if (!g.ok) return g.response
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    if (b.notitie !== undefined) patch.notitie = String(b.notitie ?? '').trim().slice(0, 500) || null

    const wiltTijd = b.duurMinuten !== undefined || b.datum !== undefined || b.tijd !== undefined
    if (wiltTijd) {
      if (!g.rij.einde_op) return NextResponse.json({ error: 'Stop de sessie eerst; daarna kan je de duur aanpassen.' }, { status: 409 })
      let start = new Date(g.rij.start_op)
      if (b.datum !== undefined || b.tijd !== undefined) {
        const huidig = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(start)
        const huidigeTijd = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(start)
        const nieuw = brusselNaarUtc(String(b.datum ?? huidig), String(b.tijd ?? huidigeTijd))
        if (!nieuw) return NextResponse.json({ error: 'Kies een geldige datum (en tijd).' }, { status: 400 })
        if (nieuw.getTime() > Date.now() + 60_000) return NextResponse.json({ error: 'Beltijd in de toekomst kan niet.' }, { status: 400 })
        start = nieuw
        patch.start_op = start.toISOString()
      }
      let duur = typeof g.rij.duur_seconden === 'number' ? g.rij.duur_seconden
        : Math.max(0, Math.round((new Date(g.rij.einde_op).getTime() - new Date(g.rij.start_op).getTime()) / 1000))
      if (b.duurMinuten !== undefined) {
        const minuten = Number(String(b.duurMinuten ?? '').replace(',', '.'))
        if (!Number.isFinite(minuten) || minuten <= 0) return NextResponse.json({ error: 'Geef de duur in minuten.' }, { status: 400 })
        if (minuten > MAX_HANDMATIG_MINUTEN) return NextResponse.json({ error: `Maximaal ${MAX_HANDMATIG_MINUTEN / 60} uur per sessie.` }, { status: 400 })
        duur = Math.round(minuten * 60)
      }
      patch.duur_seconden = duur
      patch.einde_op = new Date(start.getTime() + duur * 1000).toISOString()
    }
    if (!Object.keys(patch).length) return NextResponse.json({ ok: true })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('sales_beltijd').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — zacht (verwijderd_op). Telt daarna niet meer mee.
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const g = await magBewerken(id)
    if (!g.ok) return g.response
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('sales_beltijd').update({ verwijderd_op: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
