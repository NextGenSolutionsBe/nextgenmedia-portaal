import { redirect } from 'next/navigation'
import { Ticket } from 'lucide-react'
import { magIk } from '@/lib/instellingen/laden'
import { EventsAdmin } from './events-admin'

export const dynamic = 'force-dynamic'

/** Workshops & events: webinars, workshops, events en opleidingen inplannen en de inschrijvingen opvolgen. */
export default async function EventsPage() {
  if (!(await magIk('events', 'bekijken'))) redirect('/admin')
  const [toevoegen, aanpassen, verwijderen] = await Promise.all([magIk('events', 'toevoegen'), magIk('events', 'aanpassen'), magIk('events', 'verwijderen')])
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Ticket className="h-6 w-6" />Workshops & events</h1>
        <p className="text-sm text-gray-500 mt-0.5">Webinars, workshops, events en opleidingen. Na publiceren zien klanten ze in de klantapp en schrijven ze zich in. Online events krijgen een Google Meet-link. Elke inschrijver krijgt een bevestiging met de link en de dag voordien een herinnering. Betalen gebeurt niet in de app: wie inschrijft, krijgt achteraf een Peppol-factuur.</p>
      </div>
      <EventsAdmin magToevoegen={!!toevoegen} magAanpassen={!!aanpassen} magVerwijderen={!!verwijderen} />
    </div>
  )
}
