import { redirect } from 'next/navigation'
import { Handshake } from 'lucide-react'
import { magIk } from '@/lib/instellingen/laden'
import { PartnersAdmin } from './partners-admin'

export const dynamic = 'force-dynamic'

/** Onze partners: de bedrijven die klanten in hun klantapp zien, met uitleg en socials. */
export default async function OnzePartnersPage() {
  if (!(await magIk('onze_partners', 'bekijken'))) redirect('/admin')
  const magAanpassen = !!(await magIk('onze_partners', 'aanpassen'))
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Handshake className="h-6 w-6" />Onze partners</h1>
        <p className="text-sm text-gray-500 mt-0.5">Onze bedrijven en partners zoals klanten ze zien in de klantapp: logo, korte uitleg en links naar website en socials.</p>
      </div>
      <PartnersAdmin magAanpassen={magAanpassen} />
    </div>
  )
}
