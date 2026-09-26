import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logLeadEvent } from '@/lib/sales/service'
import { leesOpdrachtInvoer, opdrachtRegel } from '@/lib/sales/opdrachten-model'

export const dynamic = 'force-dynamic'

/**
 * Eén opdracht van een lead, vanuit de pipeline. De opdracht zelf staat in de
 * tabel `opdrachten` (de Opdrachten-pagina): titel, bedrag en omschrijving
 * aanpassen gebeurt daar rechtstreeks. "Verwijderen" in de pipeline maakt de
 * opdracht enkel LOS van de lead; de opdracht blijft bestaan op de Opdrachten-pagina.
 */
type Params = { params: Promise<{ id: string; opdrachtId: string }> }
type Rij = { id: string; lead_id: string; titel: string; bedrag_excl: number | string | null }
const cents = (v: number | string | null) => Math.max(0, Math.round((Number(v) || 0) * 100))

async function haalRij(id: string, opdrachtId: string): Promise<{ rij: Rij | null; fout: NextResponse | null }> {
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin.from('opdrachten').select('id, lead_id, titel, bedrag_excl').eq('id', opdrachtId).eq('lead_id', id).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return { rij: null, fout: NextResponse.json({ error: 'Opdracht niet gevonden' }, { status: 404 }) }
  return { rij: data as Rij, fout: null }
}

// PATCH { titel?, bedrag? | bedrag_cents?, notitie? }
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id, opdrachtId } = await params
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const gelezen = leesOpdrachtInvoer(b, false)
    if (!gelezen.ok) return NextResponse.json({ error: gelezen.error }, { status: 400 })
    const { rij, fout } = await haalRij(id, opdrachtId)
    if (fout || !rij) return fout!
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (gelezen.invoer.titel !== undefined) patch.titel = gelezen.invoer.titel
    if (gelezen.invoer.bedrag_cents !== undefined) patch.bedrag_excl = gelezen.invoer.bedrag_cents / 100
    if (gelezen.invoer.notitie !== undefined) patch.omschrijving = gelezen.invoer.notitie
    if (Object.keys(patch).length === 1) return NextResponse.json({ ok: true })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('opdrachten').update(patch).eq('id', opdrachtId)
    if (error) throw new Error(error.message)
    const titel = gelezen.invoer.titel ?? rij.titel
    const bedrag = gelezen.invoer.bedrag_cents ?? cents(rij.bedrag_excl)
    if (titel !== rij.titel || bedrag !== cents(rij.bedrag_excl)) {
      await logLeadEvent(id, { kind: 'system', body: opdrachtRegel('aangepast', titel, bedrag), actorId: actor.id, actorEmail: actor.email ?? null })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — loskoppelen van de lead (de opdracht blijft bestaan).
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id, opdrachtId } = await params
    const { rij, fout } = await haalRij(id, opdrachtId)
    if (fout || !rij) return fout!
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('opdrachten').update({ lead_id: null, updated_at: new Date().toISOString() }).eq('id', opdrachtId)
    if (error) throw new Error(error.message)
    await logLeadEvent(id, { kind: 'system', body: `Opdracht losgekoppeld: ${rij.titel}`, actorId: actor.id, actorEmail: actor.email ?? null })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
