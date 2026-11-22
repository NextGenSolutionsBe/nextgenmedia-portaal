import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { merkNaam } from '@/lib/sales/lead-taken'
import { ngsTaken, leadTaakOpties, maakNgsTaak, ngsTaakOpnieuw, ngsTaakVerantwoordelijke, ngsStandaard, LeadTaakFout } from '@/lib/sales/lead-taken-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Opvolgtaken bij een deal van NextGen Solutions (ClickUp), zelfde werking als bij projecten.
 *  GET            → de taken met status en verantwoordelijke, live uit ClickUp
 *  GET ?opties=1  → ClickUp-leden, lijsten en de standaard-verantwoordelijke
 *  POST           → nieuwe taak { aanvraag_sleutel, omschrijving, deadline, notitie, assignee_id, merk }
 *  PATCH          → { taak_id, actie: 'opnieuw' } of { taak_id, actie: 'verantwoordelijke', assignee_id }
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const datumKort = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })

function fout(e: unknown, plek: string) {
  if (e instanceof LeadTaakFout) return NextResponse.json({ error: e.publiek }, { status: e.status })
  return NextResponse.json({ error: safeMessage(e, plek) }, { status: 500 })
}

async function regel(dealId: string, tekst: string, user: { email?: string | null }) {
  const ident = await leesAdminIdentiteit().catch(() => null)
  await createAdminSupabaseClient().from('ngs_deal_notities').insert({ deal_id: dealId, tekst, soort: 'systeem', door: ident?.naam || user.email || null })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Deal niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    if (req.nextUrl.searchParams.get('opties') === '1') return NextResponse.json(await leadTaakOpties(admin, user.email ?? null, await ngsStandaard(admin, id)))
    return NextResponse.json(await ngsTaken(admin, id), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return fout(e, 'ngs-taken.GET') }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Deal niet gevonden' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const { taak, herhaald } = await maakNgsTaak(admin, id, b, { userId: user.id, email: user.email ?? null })
    if (!herhaald) {
      await regel(id, `Taak ${taak.sync_status === 'ok' ? 'in ClickUp' : 'aangemaakt (ClickUp mislukt)'}: ${taak.omschrijving}${taak.deadline ? `, ${datumKort(taak.deadline)}` : ''}, voor ${taak.clickup_assignee_naam ?? '—'} (${merkNaam(taak.merk)})`, user)
      const { ip, userAgent } = requestMeta(req)
      await logAudit({ action: 'ngs.taak_toegevoegd', entityType: 'ngs_deal', entityId: id, actorUserId: user.id, actorEmail: user.email ?? null, summary: taak.omschrijving, ip, userAgent, metadata: { clickup: taak.sync_status, taak: taak.clickup_task_id } })
    }
    return NextResponse.json({ taak, herhaald })
  } catch (e) { return fout(e, 'ngs-taken.POST') }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Deal niet gevonden' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as { taak_id?: string; actie?: string; assignee_id?: unknown }
    const admin = createAdminSupabaseClient()
    if (b.actie === 'verantwoordelijke') {
      const taak = await ngsTaakVerantwoordelijke(admin, id, String(b.taak_id ?? ''), b.assignee_id)
      await regel(id, `Taak "${taak.omschrijving}": verantwoordelijke is nu ${taak.clickup_assignee_naam ?? '—'}`, user)
      return NextResponse.json({ taak })
    }
    if (b.actie !== 'opnieuw') return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    return NextResponse.json({ taak: await ngsTaakOpnieuw(admin, id, String(b.taak_id ?? '')) })
  } catch (e) { return fout(e, 'ngs-taken.PATCH') }
}
