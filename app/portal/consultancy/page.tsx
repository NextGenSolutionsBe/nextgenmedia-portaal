export const dynamic = 'force-dynamic'

import { Lightbulb } from 'lucide-react'
import { requirePortalView } from '@/lib/portal-auth'
import { AanvraagModule } from '@/components/portal/aanvragen/aanvraag-module'
import { CONSULTANCY_TARIEF } from '@/lib/aanvragen/model'

/**
 * Klantapp — Consultancy aanvragen: betalende gesprekken, workshops en scans
 * aan €125 per uur. Wij bepalen duur, eventuele offerte en planning; de klant
 * boekt zelf geen afspraak.
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
        <div className="rounded-xl border border-gray-900 bg-white px-4 py-2 text-center shrink-0">
          <div className="text-lg font-semibold leading-tight">{CONSULTANCY_TARIEF}</div>
          <div className="text-[11px] text-gray-500">duur en offerte bepalen wij</div>
        </div>
      </div>
      <AanvraagModule soort="consultancy" />
    </div>
  )
}
