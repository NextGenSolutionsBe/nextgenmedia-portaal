import { safeMessage } from '@/lib/api-error'
import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { laadOpdrachtenVanLead, voegOpdrachtToe } from '@/lib/sales/lead-opdrachten'
import { leesOpdrachtInvoer, somOpdrachten } from '@/lib/sales/opdrachten-model'

export const dynamic = 'force-dynamic'

/**
 * Opdrachten van één lead (titel + bedrag excl. btw).
 *
 * GET  → { opdrachten, totaal_cents, beschikbaar }  (beschikbaar=false vóór de migratie)
 * POST { titel, bedrag | bedrag_cents, dienst?, notitie? } → { ok, opdracht }
 *
 * Toegang: zoals de rest van de pipeline (staff met de verkoopmodule; de
 * middleware bewaakt /api/admin/sales).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const opdrachten = await laadOpdrachtenVanLead(admin, id)
    if (opdrachten === null) return NextResponse.json({ opdrachten: [], totaal_cents: 0, beschikbaar: false })
    return NextResponse.json({ opdrachten, totaal_cents: somOpdrachten(opdrachten), beschikbaar: true })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireStaff()
    if (!actor) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const gelezen = leesOpdrachtInvoer(b, true)
    if (!gelezen.ok) return NextResponse.json({ error: gelezen.error }, { status: 400 })

    const admin = createAdminSupabaseClient()
    const { data: lead } = await admin.from('sales_leads').select('id').eq('id', id).maybeSingle()
    if (!lead) return NextResponse.json({ error: 'Lead niet gevonden' }, { status: 404 })

    const res = await voegOpdrachtToe(admin, {
      leadId: id,
      invoer: { ...gelezen.invoer, titel: gelezen.invoer.titel as string, bedrag_cents: gelezen.invoer.bedrag_cents ?? 0 },
      actor: { id: actor.id, email: actor.email ?? null },
    })
    if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.migratie ? 503 : 400 })
    return NextResponse.json({ ok: true, opdracht: res.opdracht })
  } catch (err) {
    return NextResponse.json({ error: safeMessage(err) }, { status: 400 })
  }
}
