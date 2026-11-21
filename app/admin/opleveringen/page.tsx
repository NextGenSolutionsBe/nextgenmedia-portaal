import { redirect } from 'next/navigation'
import { PackageCheck } from 'lucide-react'
import { magIk } from '@/lib/instellingen/laden'
import { OpleveringenAdmin } from './opleveringen-admin'

export const dynamic = 'force-dynamic'

/** Opleveringen: video's, ontwerpen, foto's en documenten laten bekijken, downloaden en feedback geven. */
export default async function OpleveringenPage() {
  if (!(await magIk('opleveringen', 'bekijken'))) redirect('/admin')
  const [toevoegen, aanpassen, verwijderen] = await Promise.all([magIk('opleveringen', 'toevoegen'), magIk('opleveringen', 'aanpassen'), magIk('opleveringen', 'verwijderen')])
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><PackageCheck className="h-6 w-6" />Opleveringen</h1>
        <p className="text-sm text-gray-500 mt-0.5">Video, ontwerp, foto&apos;s en documenten voor klanten. Bestanden blijven 3 dagen beschikbaar: bewaar altijd een backup.</p>
      </div>
      <OpleveringenAdmin magToevoegen={!!toevoegen} magAanpassen={!!aanpassen} magVerwijderen={!!verwijderen} />
    </div>
  )
}
