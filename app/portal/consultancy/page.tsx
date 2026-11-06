export const dynamic = 'force-dynamic'

import { Lightbulb } from 'lucide-react'
import { requirePortalView } from '@/lib/portal-auth'
import { AanvraagModule } from '@/components/portal/aanvragen/aanvraag-module'

/**
 * Klantapp — Consultancy aanvragen: gesprekken, workshops en scans. Wij
 * bepalen duur, eventuele offerte en planning; de klant boekt zelf geen
 * afspraak. Er staat bewust geen uurtarief in de app.
 */
export default async function PortalConsultancyPage() {
  await requirePortalView('consultancy')
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Lightbulb className="h-6 w-6" />Consultancy aanvragen</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">Advies, een workshop of een scan van een expert. Beschrijf je vraag en gewenste timing; wij bepalen hoeveel tijd ervoor nodig is en sturen indien nodig eerst een offerte. Je boekt hier geen afspraak.</p>
        </div>
      </div>
      <AanvraagModule soort="consultancy" />
    </div>
  )
}
