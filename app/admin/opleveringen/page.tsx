import { redirect } from 'next/navigation'
import { Film } from 'lucide-react'
import { magIk } from '@/lib/instellingen/laden'
import { OpleveringenAdmin } from './opleveringen-admin'

export const dynamic = 'force-dynamic'

/** Video-opleveringen: losse video's en beeldmateriaal laten bekijken, downloaden en feedback geven. */
export default async function OpleveringenPage() {
  if (!(await magIk('opleveringen', 'bekijken'))) redirect('/admin')
  const [toevoegen, aanpassen, verwijderen] = await Promise.all([magIk('opleveringen', 'toevoegen'), magIk('opleveringen', 'aanpassen'), magIk('opleveringen', 'verwijderen')])
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Film className="h-6 w-6" />Video-opleveringen</h1>
        <p className="text-sm text-gray-500 mt-0.5">Voor losse video&apos;s zoals aftermovies, promotievideo&apos;s en testimonials, geen socialemediacontent (die loopt via Metricool). De klant bekijkt, downloadt in volle kwaliteit en geeft feedback met tijdcodes: eerste versie, revisieronde 1, revisieronde 2, finale versie. Bestanden gaan rechtstreeks naar de opslag en blijven 3 dagen beschikbaar; daarna haalt de app ze weg. Bewaar dus altijd een backup.</p>
      </div>
      <OpleveringenAdmin magToevoegen={!!toevoegen} magAanpassen={!!aanpassen} magVerwijderen={!!verwijderen} />
    </div>
  )
}
