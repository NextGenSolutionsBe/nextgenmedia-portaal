import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'
import { rateLimit } from '@/lib/rate-limit'
import { safeMessage } from '@/lib/api-error'
import { aanvragenVanKlant, maakAanvraag, AanvraagFout } from '@/lib/aanvragen/server'
import { moduleVoor, soortUit } from '@/lib/aanvragen/portaal'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * Klantportaal — Diensten en Consultancy aanvragen.
 *  GET  ?soort=dienst|consultancy → de eigen aanvragen (enkel van deze klant)
 *  POST → nieuwe aanvraag. Geen boeking en geen opdracht: wij beoordelen en plannen.
 */
export async function GET(req: NextRequest) {
  const soort = soortUit(req.nextUrl.searchParams.get('soort'))
  if (!soort) return NextResponse.json({ error: 'Onbekend soort aanvraag' }, { status: 400 })
  const g = await requirePortalPermission(moduleVoor(soort), 'view')
  if (!g.ok) return g.response
  try {
    return NextResponse.json({
      aanvragen: await aanvragenVanKlant(createAdminSupabaseClient(), g.session.clientId, soort),
      profiel: { naam: g.session.name, email: g.session.email },
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) { return NextResponse.json({ error: safeMessage(e, 'portal-aanvragen.GET') }, { status: 500 }) }
}

export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({})) as Record<string, unknown>
  const soort = soortUit(b.soort)
  if (!soort) return NextResponse.json({ error: 'Onbekend soort aanvraag' }, { status: 400 })
  const g = await requirePortalPermission(moduleVoor(soort), 'aanvragen')
  if (!g.ok) return g.response
  const rl = await rateLimit(`aanvraag:${g.session.userId}`, { limit: 15, windowSec: 3600 })
  if (!rl.allowed) return NextResponse.json({ error: 'Even te veel aanvragen na elkaar. Probeer het later opnieuw.' }, { status: 429 })
  try {
    const { aanvraag, herhaald } = await maakAanvraag(createAdminSupabaseClient(), g.session.clientId, { ...b, soort }, {
      userId: g.session.userId, email: g.session.email, naam: g.session.name,
    })
    if (!herhaald) await logPortalAction(g.session, 'aanvraag.ingediend', { type: 'klant_aanvraag', id: aanvraag.id }, { req, meta: { soort, type: aanvraag.type } })
    return NextResponse.json({ id: aanvraag.id, status: aanvraag.status, herhaald })
  } catch (e) {
    if (e instanceof AanvraagFout) return NextResponse.json({ error: e.publiek }, { status: e.status })
    return NextResponse.json({ error: safeMessage(e, 'portal-aanvragen.POST') }, { status: 500 })
  }
}
