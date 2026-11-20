import { redirect } from 'next/navigation'
import { Megaphone } from 'lucide-react'
import { magIk } from '@/lib/instellingen/laden'
import { NieuwsbrievenLijst } from './nieuwsbrieven-lijst'

export const dynamic = 'force-dynamic'

/** Nieuwsbrieven: verhalen voor klanten in de klantapp, en per mail. */
export default async function NieuwsbrievenPage() {
  if (!(await magIk('nieuwsbrieven', 'bekijken'))) redirect('/admin')
  const magMaken = !!(await magIk('nieuwsbrieven', 'toevoegen'))
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Megaphone className="h-6 w-6" />Nieuwsbrieven</h1>
        <p className="text-sm text-gray-500 mt-0.5">Afgeronde projecten, klant in de kijker, tips en marketingnieuws. Wat je publiceert, staat meteen in de klantapp onder “Nieuws”. Per mail versturen doe je daarna zelf, met een voorbeeld.</p>
      </div>
      <NieuwsbrievenLijst magMaken={magMaken} />
    </div>
  )
}
