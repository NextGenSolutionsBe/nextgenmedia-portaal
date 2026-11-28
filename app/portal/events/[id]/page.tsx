export const dynamic = 'force-dynamic'

import { notFound } from 'next/navigation'
import { requirePortalView, sessionCan } from '@/lib/portal-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { portaalEvents, appLinkVoor } from '@/lib/events-server'
import { EventDetail } from '@/components/portal/events/event-detail'

/** Eén event: alle info, aftelling, inschrijven of uitschrijven, Meet-link voor wie ingeschreven is. */
export default async function PortalEventPage({ params }: { params: { id: string } }) {
  const session = await requirePortalView('events')
  if (!/^[0-9a-f-]{36}$/i.test(params.id)) notFound()
  const [e] = await portaalEvents(createAdminSupabaseClient(), session.clientId, { id: params.id })
  if (!e) notFound()
  return (
    <EventDetail e={e} ik={{ naam: session.name ?? '', email: session.email ?? '' }}
      magInschrijven={sessionCan(session, 'events', 'inschrijven')} appLink={appLinkVoor(e.id)} />
  )
}
