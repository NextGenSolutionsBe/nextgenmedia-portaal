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
        <p className="text-sm text-gray-500 mt-0.5">Alles wat we aan een klant opleveren: video&apos;s (aftermovies, promotievideo&apos;s, testimonials), grafisch ontwerp (logo&apos;s, svg, pdf, drukwerk), foto&apos;s en documenten. Socialemediacontent loopt via Metricool. De klant bekijkt, downloadt in volle kwaliteit en geeft feedback (bij video met tijdcodes, anders per bestand): eerste versie, revisieronde 1, revisieronde 2, finale versie. Bestanden blijven 3 dagen beschikbaar; daarna haalt de app ze weg. Bewaar dus altijd een backup.</p>
      </div>
      <OpleveringenAdmin magToevoegen={!!toevoegen} magAanpassen={!!aanpassen} magVerwijderen={!!verwijderen} />
    </div>
  )
}
