import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { voegNotitieToe } from '@/lib/opdrachten-notities'
import { merkNaam } from '@/lib/sales/lead-taken'
import {
  opdrachtTaken, leadTaakOpties, maakOpdrachtTaak, opdrachtTaakOpnieuw, opdrachtTaakVerantwoordelijke, opdrachtStandaard, LeadTaakFout,
} from '@/lib/sales/lead-taken-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Taken bij een opdracht (ClickUp), zoals bij een lead in de pipeline.
 *  GET            → de taken met hun status en verantwoordelijke, live uit ClickUp
 *  GET ?opties=1  → ClickUp-leden, de lijsten en de standaard-verantwoordelijke
 *  POST           → nieuwe taak: { aanvraag_sleutel, omschrijving, deadline, notitie, assignee_id, merk }
 *  PATCH          → { taak_id, actie: 'opnieuw' } of { taak_id, actie: 'verantwoordelijke', assignee_id }
 * Toegang: module Opdrachten (middleware per methode) en actief teamlid.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const datumKort = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })

function fout(e: unknown, plek: string) {
  if (e instanceof LeadTaakFout) return NextResponse.json({ error: e.publiek }, { status: e.status })
  return NextResponse.json({ error: safeMessage(e, plek) }, { status: 500 })
}

async function systeemregel(opdrachtId: string, tekst: string, user: { id: string; email?: string | null }) {
  const admin = createAdminSupabaseClient()
  const ident = await leesAdminIdentiteit().catch(() => null)
  await voegNotitieToe(admin, opdrachtId, tekst, 'systeem', { id: user.id, email: user.email ?? null, naam: ident?.naam || null }).catch(() => null)
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Opdracht niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    if (req.nextUrl.searchParams.get('opties') === '1') return NextResponse.json(await leadTaakOpties(admin, user.email ?? null, await opdrachtStandaard(admin, id)))
    return NextResponse.json(await opdrachtTaken(admin, id), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return fout(e, 'opdracht-taken.GET') }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Opdracht niet gevonden' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const { taak, herhaald } = await maakOpdrachtTaak(admin, id, b, { userId: user.id, email: user.email ?? null })
    if (!herhaald) {
      await systeemregel(id, `Taak ${taak.sync_status === 'ok' ? 'in ClickUp' : 'aangemaakt (ClickUp mislukt)'}: ${taak.omschrijving}${taak.deadline ? `, deadline ${datumKort(taak.deadline)}` : ''}, voor ${taak.clickup_assignee_naam ?? '—'} (${merkNaam(taak.merk)})`, user)
      await admin.from('opdrachten').update({ updated_at: new Date().toISOString() }).eq('id', id)
      const { ip, userAgent } = requestMeta(req)
      await logAudit({
        action: 'opdracht.taak_toegevoegd', entityType: 'opdracht', entityId: id, actorUserId: user.id, actorEmail: user.email ?? null,
        summary: taak.omschrijving, ip, userAgent, metadata: { merk: taak.merk, clickup: taak.sync_status, taak: taak.clickup_task_id },
      })
    }
    return NextResponse.json({ taak, herhaald })
  } catch (e) { return fout(e, 'opdracht-taken.POST') }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Opdracht niet gevonden' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as { taak_id?: string; actie?: string; assignee_id?: unknown }
    const admin = createAdminSupabaseClient()
    if (b.actie === 'verantwoordelijke') {
      const taak = await opdrachtTaakVerantwoordelijke(admin, id, String(b.taak_id ?? ''), b.assignee_id)
      await systeemregel(id, `Taak "${taak.omschrijving}": verantwoordelijke is nu ${taak.clickup_assignee_naam ?? '—'}`, user)
      return NextResponse.json({ taak })
    }
    if (b.actie !== 'opnieuw') return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    return NextResponse.json({ taak: await opdrachtTaakOpnieuw(admin, id, String(b.taak_id ?? '')) })
  } catch (e) { return fout(e, 'opdracht-taken.PATCH') }
}
