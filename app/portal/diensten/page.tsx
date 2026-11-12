export const dynamic = 'force-dynamic'

import { Sparkles } from 'lucide-react'
import { requirePortalView } from '@/lib/portal-auth'
import { AanvraagModule } from '@/components/portal/aanvragen/aanvraag-module'

/**
 * Klantapp — Diensten aanvragen. De klant kiest een dienst en geeft wensen,
 * briefing en gewenste timing door. Geen boeking: wij beoordelen en plannen in.
 */
export default async function PortalDienstenPage() {
  await requirePortalView('diensten')
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Sparkles className="h-6 w-6" />Diensten aanvragen</h1>
        <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">Vertel ons wat je nodig hebt en wanneer het je past. We bekijken je aanvraag en komen bij je terug met een voorstel en planning. Een aanvraag is nog geen boeking.</p>
      </div>
      <AanvraagModule soort="dienst" />
    </div>
  )
}
