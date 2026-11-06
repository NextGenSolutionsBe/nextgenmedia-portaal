import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { safeMessage } from '@/lib/api-error'
import { logAudit, requestMeta } from '@/lib/audit'
import { merkNaam, kiesClickupLid } from '@/lib/sales/lead-taken'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import {
  takenOverzicht, leadTaakOpties, maakTeamTaak, teamTaakOpnieuw, teamTaakVerantwoordelijke, taakAfvinken, opdrachtTaakVerantwoordelijke, LeadTaakFout,
} from '@/lib/sales/lead-taken-server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Taken in het Command Center: aan elkaar toewijzen, gesynchroniseerd met ClickUp.
 *  GET            → open taken (teamtaken en taken bij projecten), live uit ClickUp
 *  GET ?opties=1  → ClickUp-leden, de lijsten (NextGenMedia/NextGenSolutions) en wie ik ben
 *  POST           → nieuwe teamtaak: { aanvraag_sleutel, omschrijving, deadline, notitie, assignee_id, merk, client_id? }
 *  PATCH          → { taak_id, soort, actie: 'af' | 'opnieuw' | 'verantwoordelijke', assignee_id? }
 * Elke interne gebruiker (admin of actief teamlid).
 */

function fout(e: unknown, plek: string) {
  if (e instanceof LeadTaakFout) return NextResponse.json({ error: e.publiek }, { status: e.status })
  return NextResponse.json({ error: safeMessage(e, plek) }, { status: 500 })
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const admin = createAdminSupabaseClient()
    if (req.nextUrl.searchParams.get('opties') === '1') {
      const o = await leadTaakOpties(admin, user.email ?? null)
      // In ClickUp staat soms een ander adres dan de login (bv. info@): dan op voornaam.
      if (!o.ik) {
        const ident = await leesAdminIdentiteit().catch(() => null)
        o.ik = ident?.naam ? kiesClickupLid(o.leden, { naam: ident.naam }) : null
      }
      return NextResponse.json(o)
    }
    const { taken, statusFout } = await takenOverzicht(admin)
    return NextResponse.json({ taken, statusFout })
  } catch (e) { return fout(e, 'taken.GET') }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({}))
    const admin = createAdminSupabaseClient()
    const { taak, herhaald } = await maakTeamTaak(admin, b, { userId: user.id, email: user.email ?? null })
    if (!herhaald) {
      const meta = requestMeta(req)
      await logAudit({
        action: 'teamtaak.aangemaakt', entityType: 'team_taak', entityId: taak.id,
        summary: `Taak "${taak.omschrijving}" voor ${taak.clickup_assignee_naam ?? '?'} (${merkNaam(taak.merk)})`,
        actorUserId: user.id, actorEmail: user.email ?? null, ip: meta.ip, userAgent: meta.userAgent,
      })
    }
    return NextResponse.json({ taak, herhaald })
  } catch (e) { return fout(e, 'taken.POST') }
}

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireStaff()
    if (!user) return NextResponse.json({ error: 'Geen toegang' }, { status: 403 })
    const b = await req.json().catch(() => ({})) as { taak_id?: unknown; soort?: unknown; actie?: unknown; assignee_id?: unknown }
    const id = String(b.taak_id ?? '')
    const soort = b.soort === 'opdracht' ? 'opdracht' : 'team'
    const admin = createAdminSupabaseClient()
    if (b.actie === 'af') {
      const taak = await taakAfvinken(admin, soort, id)
      await logAudit({ action: 'teamtaak.af', entityType: soort === 'team' ? 'team_taak' : 'opdracht_taak', entityId: id, summary: `Taak "${taak.omschrijving}" afgevinkt`, actorUserId: user.id, actorEmail: user.email ?? null })
      return NextResponse.json({ taak })
    }
    if (b.actie === 'opnieuw' && soort === 'team') return NextResponse.json({ taak: await teamTaakOpnieuw(admin, id) })
    if (b.actie === 'verantwoordelijke') {
      if (soort === 'team') return NextResponse.json({ taak: await teamTaakVerantwoordelijke(admin, id, b.assignee_id) })
      const { data } = await admin.from('opdracht_taken').select('opdracht_id').eq('id', id).maybeSingle()
      if (!data) return NextResponse.json({ error: 'Taak niet gevonden.' }, { status: 404 })
      return NextResponse.json({ taak: await opdrachtTaakVerantwoordelijke(admin, String((data as { opdracht_id: string }).opdracht_id), id, b.assignee_id) })
    }
    return NextResponse.json({ error: 'Onbekende actie.' }, { status: 400 })
  } catch (e) { return fout(e, 'taken.PATCH') }
}
