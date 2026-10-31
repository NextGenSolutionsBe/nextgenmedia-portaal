import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { Inbox } from 'lucide-react'
import { magIk } from '@/lib/instellingen/laden'
import { AanvragenAdmin } from './aanvragen-admin'

export const dynamic = 'force-dynamic'

/** Aanvragen van diensten en consultancy uit het klantportaal: beoordelen, scope, offerte en opvolging. */
export default async function AanvragenPage() {
  const persoon = await magIk('aanvragen', 'bekijken')
  if (!persoon) redirect('/admin')
  const magAanpassen = !!(await magIk('aanvragen', 'aanpassen'))
  const magVerwijderen = !!(await magIk('aanvragen', 'verwijderen'))
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Inbox className="h-6 w-6" />Aanvragen</h1>
        <p className="text-sm text-gray-500 mt-0.5">Wat klanten aanvragen via hun klantapp. Een aanvraag is nog geen opdracht of boeking: beoordeel ze, duid de scope aan, koppel indien nodig een offerte en plan intern in.</p>
      </div>
      <Suspense><AanvragenAdmin magAanpassen={magAanpassen} magVerwijderen={magVerwijderen} /></Suspense>
    </div>
  )
}
