export const dynamic = 'force-dynamic'

import { Video } from 'lucide-react'
import { requirePortalView } from '@/lib/portal-auth'
import { KlantMeetings } from './klant-meetings'

/**
 * Klantapp — Meeting boeken. Een gratis meeting van 30 minuten met
 * NextGenMedia op een vrij moment (11:00–17:00, minstens 3 dagen vooraf), en
 * het overzicht van de eigen geboekte meetings.
 */
export default async function PortalMeetingsPage() {
  await requirePortalView('meetings')
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Video className="h-6 w-6" />Meeting boeken</h1>
        <p className="text-sm text-gray-500 mt-0.5">Plan zelf een gratis online meeting van 30 minuten met NextGenMedia, via Google Meet.</p>
      </div>
      <KlantMeetings />
    </div>
  )
}
