import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireAdmin, requireStaff } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Eén activiteit aanpassen of zacht verwijderen.
 *
 * Enkel de AUTEUR of een admin. Interne notities zijn intern: ze komen nooit
 * in een portaal of een mail terecht, maar wie er een schreef mag hem wel
 * rechtzetten. Verwijderen zet verwijderd_op; de rij blijft bestaan, de
 * statistiek telt hem niet meer.
 */
async function magBewerken(id: string): Promise<
  | { ok: true; actorId: string; rij: { id: string; medewerker_id: string | null; type: string } }
  | { ok: false; response: NextResponse }
> {
  const actor = await requireStaff()
  if (!actor) return { ok: false, response: NextResponse.json({ error: 'Geen toegang' }, { status: 403 }) }
  const admin = createAdminSupabaseClient()
  const { data } = await admin.from('sales_activiteiten')
    .select('id, medewerker_id, type').eq('id', id).is('verwijderd_op', null).maybeSingle()
  if (!data) return { ok: false, response: NextResponse.json({ error: 'Activiteit niet gevonden' }, { status: 404 }) }
  const rij = data as { id: string; medewerker_id: string | null; type: string }
  if (rij.medewerker_id !== actor.id && !(await requireAdmin())) {
    return { ok: false, response: NextResponse.json({ error: 'Enkel de auteur of een admin kan dit aanpassen.' }, { status: 403 }) }
  }
  return { ok: true, actorId: actor.id, rij }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const g = await magBewerken(id)
    if (!g.ok) return g.response
    const b = await req.json().catch(() => ({}))
    const patch: Record<string, unknown> = {}
    if (b.notitie !== undefined) patch.notitie = String(b.notitie ?? '').trim().slice(0, 4000) || null
    if (g.rij.type === 'telefoongesprek') {
      if (b.duurSeconden !== undefined) {
        const n = b.duurSeconden === null || b.duurSeconden === '' ? null : Number(b.duurSeconden)
        if (n !== null && (!Number.isFinite(n) || n < 0 || n > 6 * 3600)) {
          return NextResponse.json({ error: 'De gespreksduur klopt niet.' }, { status: 400 })
        }
        patch.duur_seconden = n === null ? null : Math.round(n)
      }
      if (b.uitkomst !== undefined) patch.uitkomst = String(b.uitkomst ?? '') || null
    }
    if (g.rij.type === 'interne_notitie' && patch.notitie === null) {
      return NextResponse.json({ error: 'Een notitie zonder tekst heeft geen zin — verwijder hem dan.' }, { status: 400 })
    }
    if (!Object.keys(patch).length) return NextResponse.json({ ok: true })
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('sales_activiteiten').update(patch).eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const g = await magBewerken(id)
    if (!g.ok) return g.response
    const admin = createAdminSupabaseClient()
    const { error } = await admin.from('sales_activiteiten')
      .update({ verwijderd_op: new Date().toISOString() }).eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
