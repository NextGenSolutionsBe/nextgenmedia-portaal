export const dynamic = 'force-dynamic'

import { requirePortalView } from '@/lib/portal-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { portaalEvents } from '@/lib/events-server'
import { EventsOverzicht } from '@/components/portal/events/events-overzicht'

/** Klantapp — Workshops & events: komende webinars, workshops, events en opleidingen met aftelling. */
export default async function PortalEventsPage() {
  const session = await requirePortalView('events')
  const events = await portaalEvents(createAdminSupabaseClient(), session.clientId)
  return <EventsOverzicht events={events} />
}
