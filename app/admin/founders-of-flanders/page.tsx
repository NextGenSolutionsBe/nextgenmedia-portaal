import { redirect } from 'next/navigation'
import { Clapperboard } from 'lucide-react'
import { magIk } from '@/lib/instellingen/laden'
import { FoundersAdmin } from './founders-admin'

export const dynamic = 'force-dynamic'

/** Founders of Flanders: de voorbeeldvideo's die klanten zien, en hun aanvragen. */
export default async function FoundersOfFlandersPage() {
  if (!(await magIk('founders', 'bekijken'))) redirect('/admin')
  const magAanpassen = !!(await magIk('founders', 'aanpassen'))
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Clapperboard className="h-6 w-6" />Founders of Flanders</h1>
        <p className="text-sm text-gray-500 mt-0.5">De voorbeeldvideo's in de klantapp, met de knop “Vraag nu jouw founder video aan”. Video's staan op YouTube; je plakt hier enkel de link. Aanvragen komen binnen bij Aanvragen.</p>
      </div>
      <FoundersAdmin magAanpassen={magAanpassen} />
    </div>
  )
}
