import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { magIk } from '@/lib/instellingen/laden'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { teamDetail, teamActie, AanvraagFout, type AanvraagRij, type TeamActie } from '@/lib/aanvragen/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Eén aanvraag.
 *  GET   → detail, tijdelijke links naar bestanden en offerte, context (diensten en contracten van de klant), team
 *  PATCH → { actie: 'status' | 'scope' | 'toewijzen' | 'planning' | 'notitie' | 'offerte' | 'offerte_intrekken' | 'clickup_opnieuw', ... }
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!(await magIk('aanvragen', 'bekijken'))) return NextResponse.json({ error: 'Geen toegang tot Aanvragen.' }, { status: 403 })
    const { id } = await params
    const d = await teamDetail(createAdminSupabaseClient(), id)
    if (!d) return NextResponse.json({ error: 'Aanvraag niet gevonden.' }, { status: 404 })
    return NextResponse.json(d, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'aanvragen.id.GET') }, { status: 500 }) }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const persoon = await magIk('aanvragen', 'aanpassen')
    if (!persoon) return NextResponse.json({ error: 'Je mag aanvragen niet aanpassen.' }, { status: 403 })
    const { id } = await params
    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('klant_aanvragen').select('*').eq('id', id).maybeSingle()
    if (!data) return NextResponse.json({ error: 'Aanvraag niet gevonden.' }, { status: 404 })
    const b = await req.json().catch(() => ({})) as TeamActie
    // ClickUp en de audit-log ronden af na het antwoord: de knop in het scherm is meteen klaar.
    const x = await teamActie(admin, data as AanvraagRij, b, persoon.naam || persoon.email, { achtergrond: waitUntil })
    const { ip, userAgent } = requestMeta(req)
    waitUntil(logAudit({
      action: `aanvraag.${b.actie}`, entityType: 'klant_aanvraag', entityId: id, actorUserId: persoon.userId, actorEmail: persoon.email,
      summary: `${x.type_label}: ${x.status}`, ip, userAgent, metadata: { status: x.status, scope: x.scope, offerte: x.offerte_status },
    }))
    return NextResponse.json({ aanvraag: x })
  } catch (e) {
    if (e instanceof AanvraagFout) return NextResponse.json({ error: e.publiek }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'aanvragen.id.PATCH') }, { status: 500 })
  }
}
