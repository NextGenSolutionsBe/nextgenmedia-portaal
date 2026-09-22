import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { logLeadEvent } from '@/lib/sales/service'
import { isOntbrekendeTabel, MIGRATIE_NODIG } from '@/lib/sales/lead-opdrachten'
import { leesOpdrachtInvoer, opdrachtRegel } from '@/lib/sales/opdrachten-model'

export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string; opdrachtId: string }> }
type Rij = { id: string; lead_id: string; titel: string; bedrag_cents: number | string }

async function haalRij(id: string, opdrachtId: string): Promise<{ rij: Rij | null; fout: NextResponse | null }> {
  const admin = createAdminSupabaseClient()
  const { data, error } = await admin.from('sales_lead_opdrachten')
    .select('id, lead_id, titel, bedrag_cents')
    .eq('id', opdrachtId).eq('lead_id', id).is('verwijderd_op', null).maybeSingle()
  if (error) {
    if (isOntbrekendeTabel(error.message)) return { rij: null, fout: NextResponse.json({ error: MIGRATIE_NODIG }, { status: 503 }) }
    throw new Error(error.message)
  }
  if (!data) return { rij: null, fout: NextResponse.json({ error: 'Opdracht niet gevonden' }, { status: 404 }) }
  return { rij: data as Rij, fout: null }
}

// PATCH { titel?, bedrag? | bedrag_cents?, dienst?, notitie? }
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

    const patch: Record<string, unknown> = { ...gelezen.invoer, updated_at: new Date().toISOString() }
    if (Object.keys(patch).length === 1) return NextResponse.json({ ok: true })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('sales_lead_opdrachten').update(patch).eq('id', opdrachtId)
    if (error) throw new Error(error.message)

    const titel = gelezen.invoer.titel ?? rij.titel
    const bedrag = gelezen.invoer.bedrag_cents ?? (Number(rij.bedrag_cents) || 0)
    if (titel !== rij.titel || bedrag !== (Number(rij.bedrag_cents) || 0)) {
      await logLeadEvent(id, {
        kind: 'system', body: opdrachtRegel('aangepast', titel, bedrag),
        actorId: actor.id, actorEmail: actor.email ?? null,
      })
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

// DELETE — zacht: verwijderd_op zetten. De rij blijft bestaan (niets hard wissen).
export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id, opdrachtId } = await params
    const { rij, fout } = await haalRij(id, opdrachtId)
    if (fout || !rij) return fout!
    const admin = createAdminSupabaseClient()
    const nu = new Date().toISOString()
    const { error } = await admin.from('sales_lead_opdrachten').update({ verwijderd_op: nu, updated_at: nu }).eq('id', opdrachtId)
    if (error) throw new Error(error.message)
    await logLeadEvent(id, {
      kind: 'system', body: opdrachtRegel('verwijderd', rij.titel, Number(rij.bedrag_cents) || 0),
      actorId: actor.id, actorEmail: actor.email ?? null,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
