import { NextRequest, NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { logAudit } from '@/lib/audit'
import { valideerNieuwsbrief, klaarVoorPublicatie, type Nieuwsbrief } from '@/lib/nieuwsbrieven'
import { metExtra, uniekeSlug } from '@/lib/nieuwsbrieven-server'

export const dynamic = 'force-dynamic'

/**
 * Eén nieuwsbrief.
 *  GET    → volledig
 *  PATCH  → { actie: 'bewaar', ...velden } | { actie: 'publiceer', ...velden } | { actie: 'depubliceer' }
 *  DELETE → weg (enkel een concept of na depubliceren)
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await magIk('nieuwsbrieven', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang.' }, { status: 403 })
  const { id } = await params
  const { data } = await createAdminSupabaseClient().from('nieuwsbrieven').select('*').eq('id', id).maybeSingle()
  if (!data) return NextResponse.json({ error: 'Nieuwsbrief niet gevonden.' }, { status: 404 })
  return NextResponse.json({ nieuwsbrief: metExtra(data as Nieuwsbrief) }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const persoon = await magIk('nieuwsbrieven', 'aanpassen')
    if (!persoon) return NextResponse.json({ error: 'Je mag nieuwsbrieven niet aanpassen.' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { data: oud } = await admin.from('nieuwsbrieven').select('*').eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Nieuwsbrief niet gevonden.' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const nu = new Date().toISOString()
    let patch: Record<string, unknown> = { updated_at: nu }
    if (b.actie === 'depubliceer') patch.status = 'concept'
    else {
      const v = valideerNieuwsbrief(b)
      if (!v.ok) return NextResponse.json({ error: v.fout }, { status: 400 })
      patch = { ...patch, ...v.waarde }
      if (v.waarde.titel !== oud.titel && oud.status === 'concept') patch.slug = await uniekeSlug(admin, v.waarde.titel, id)
      if (b.actie === 'publiceer') {
        const nog = klaarVoorPublicatie(v.waarde)
        if (nog) return NextResponse.json({ error: nog }, { status: 400 })
        patch.status = 'gepubliceerd'
        if (!oud.gepubliceerd_op) patch.gepubliceerd_op = nu
      }
    }
    const { data, error } = await admin.from('nieuwsbrieven').update(patch).eq('id', id).select('*').single()
    if (error) throw new Error(error.message)
    if (b.actie === 'publiceer' || b.actie === 'depubliceer') {
      await logAudit({ action: `nieuwsbrief.${b.actie}`, entityType: 'nieuwsbrief', entityId: id, actorUserId: persoon.userId, actorEmail: persoon.email, summary: String(data.titel) })
      revalidatePath('/portal/nieuws')
    } else if (oud.status === 'gepubliceerd') revalidatePath('/portal/nieuws')
    return NextResponse.json({ nieuwsbrief: metExtra(data as Nieuwsbrief) })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'nieuwsbrieven.PATCH') }, { status: 500 }) }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('nieuwsbrieven', 'verwijderen'))) return NextResponse.json({ error: 'Je mag nieuwsbrieven niet verwijderen.' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { data: oud } = await admin.from('nieuwsbrieven').select('status').eq('id', id).maybeSingle()
    if (!oud) return NextResponse.json({ error: 'Nieuwsbrief niet gevonden.' }, { status: 404 })
    if (oud.status === 'gepubliceerd') return NextResponse.json({ error: 'Haal de nieuwsbrief eerst offline.' }, { status: 409 })
    const { error } = await admin.from('nieuwsbrieven').delete().eq('id', id)
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'nieuwsbrieven.DELETE') }, { status: 500 }) }
}
