import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission } from '@/lib/portal-auth'
import { bouwIcs } from '@/lib/events'
import { leesEvent, appLinkVoor } from '@/lib/events-server'

export const dynamic = 'force-dynamic'

/** Agendabestand van een event. De Meet-link staat er enkel in voor wie van deze klant ingeschreven is. */
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requirePortalPermission('events', 'view')
  if (!g.ok) return g.response
  const admin = createAdminSupabaseClient()
  const e = await leesEvent(admin, params.id)
  if (!e || e.status === 'concept') return NextResponse.json({ error: 'Event niet gevonden' }, { status: 404 })
  const { count } = await admin.from('klant_event_inschrijvingen').select('id', { count: 'exact', head: true }).eq('event_id', e.id).eq('client_id', g.session.clientId).eq('status', 'ingeschreven')
  const ics = bouwIcs({ ...e, meet_url: (count ?? 0) > 0 ? e.meet_url : null }, { appLink: appLinkVoor(e.id) })
  const naam = e.titel.replace(/[^\w\- ]+/g, '').trim().slice(0, 60) || 'event'
  return new NextResponse(ics, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename="${naam}.ics"`, 'Cache-Control': 'no-store' } })
}
