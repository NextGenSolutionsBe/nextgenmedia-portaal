import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { logLeadEvent } from '@/lib/sales/service'
import { merkNaam } from '@/lib/sales/lead-taken'
import { leadTaken, leadTaakOpties, maakLeadTaak, leadTaakOpnieuw, LeadTaakFout } from '@/lib/sales/lead-taken-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Taken bij een lead (ClickUp).
 *  GET            → de taken met hun status, live uit ClickUp
 *  GET ?opties=1  → ClickUp-leden en de lijsten NextGen Media / NextGen Solutions
 *  POST           → nieuwe taak: { aanvraag_sleutel, omschrijving, deadline, notitie, assignee_id, merk }
 *  PATCH          → { taak_id, actie: 'opnieuw' }: een taak die niet in ClickUp raakte
 * Toegang: module Verkoop (middleware per methode) en actief teamlid.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const datumKort = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })

function fout(e: unknown, plek: string) {
  if (e instanceof LeadTaakFout) return NextResponse.json({ error: e.publiek }, { status: e.status })
  return NextResponse.json({ error: safeMessage(e, plek) }, { status: 500 })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Lead niet gevonden' }, { status: 404 })
    const admin = createAdminSupabaseClient()
    if (req.nextUrl.searchParams.get('opties') === '1') return NextResponse.json(await leadTaakOpties(admin, user.email ?? null))
    return NextResponse.json(await leadTaken(admin, id), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return fout(e, 'lead-taken.GET') }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    if (!UUID.test(id)) return NextResponse.json({ error: 'Lead niet gevonden' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as Record<string, unknown>
    const admin = createAdminSupabaseClient()
    const { taak, herhaald } = await maakLeadTaak(admin, id, b, { userId: user.id, email: user.email ?? null })
    if (!herhaald) {
      const regel = `Taak ${taak.sync_status === 'ok' ? 'in ClickUp' : 'aangemaakt (ClickUp mislukt)'}: ${taak.omschrijving}${taak.deadline ? `, deadline ${datumKort(taak.deadline)}` : ''}, voor ${taak.clickup_assignee_naam ?? '—'} (${merkNaam(taak.merk)})`
      await logLeadEvent(id, { kind: 'system', body: regel, actorId: user.id, actorEmail: user.email ?? null, laatsteNotitie: false }).catch(() => undefined)
      const { ip, userAgent } = requestMeta(req)
      await logAudit({
        action: 'lead.taak_toegevoegd', entityType: 'sales_lead', entityId: id, actorUserId: user.id, actorEmail: user.email ?? null,
        summary: taak.omschrijving, ip, userAgent, metadata: { merk: taak.merk, clickup: taak.sync_status, taak: taak.clickup_task_id },
      })
    }
    return NextResponse.json({ taak, herhaald })
  } catch (e) { return fout(e, 'lead-taken.POST') }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await requireStaff())) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const { id } = await params
    const b = await req.json().catch(() => ({})) as { taak_id?: string; actie?: string }
    if (b.actie !== 'opnieuw') return NextResponse.json({ error: 'Onbekende actie' }, { status: 400 })
    const taak = await leadTaakOpnieuw(createAdminSupabaseClient(), id, String(b.taak_id ?? ''))
    return NextResponse.json({ taak })
  } catch (e) { return fout(e, 'lead-taken.PATCH') }
}
