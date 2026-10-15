export const dynamic = 'force-dynamic'

import { baseUrl } from '@/lib/email'
import { KoppelingClient } from './koppeling-client'

/**
 * De koppeling met Harrie, ons acquisitiesysteem.
 *
 * Harrie stuurt koude mails en LinkedIn-berichten naar bedrijven die hij zelf
 * opzoekt. Hij mag nooit iemand benaderen die al klant is of met wie we in
 * gesprek zijn — dat kost ons de reputatie van het adres waarmee we mailen.
 * Die kennis zit in deze app, dus geven we ze hier door.
 *
 * De identiteits- en modulecontrole gebeurt centraal in de middleware
 * (/admin/sales valt onder de module 'sales').
 */
export default function KoppelingPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Koppeling met Harrie</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Harrie haalt hier op wie hij met rust moet laten, en meldt terug wat hij deed.
          Zo krijgt geen enkele klant een koude wervingsmail, en zie je een geboekte
          afspraak gewoon in je eigen pipeline verschijnen.
        </p>
      </div>
      <KoppelingClient basisUrl={baseUrl()} />
    </div>
  )
}
