import { NextRequest, NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalPermission, logPortalAction } from '@/lib/portal-auth'
import { leesEvent, schrijfUit, syncGasten } from '@/lib/events-server'

export const dynamic = 'force-dynamic'

/** Uitschrijven (DELETE): enkel een inschrijving van de eigen klant, en enkel voor het event begint. */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await requirePortalPermission('events', 'inschrijven')
  if (!g.ok) return g.response
  const admin = createAdminSupabaseClient()
  const { data: rij } = await admin.from('klant_event_inschrijvingen').select('id, event_id, client_id, naam, status').eq('id', params.id).maybeSingle()
  if (!rij || rij.client_id !== g.session.clientId) return NextResponse.json({ error: 'Inschrijving niet gevonden' }, { status: 404 })
  const e = await leesEvent(admin, rij.event_id)
  if (e && Date.parse(e.start_op) <= Date.now()) return NextResponse.json({ error: 'Het event is al begonnen; uitschrijven kan niet meer.' }, { status: 409 })
  const r = await schrijfUit(admin, rij.id, g.session.name ?? g.session.email ?? 'Klant')
  if (!r.ok) return NextResponse.json({ error: r.fout }, { status: 409 })
  waitUntil(syncGasten(admin, r.eventId).catch(() => null))
  await logPortalAction(g.session, 'event.uitgeschreven', { type: 'klant_event', id: rij.event_id }, { req, meta: { naam: rij.naam } })
  return NextResponse.json({ ok: true })
}
