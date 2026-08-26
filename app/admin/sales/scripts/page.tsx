export const dynamic = 'force-dynamic'

import { ScriptsClient } from './scripts-client'

/**
 * Belscripts: het coldcallingscript per setter, met de AI-indeling die Focus
 * Mode toont — secties in het midden, bezwaren ernaast.
 *
 * De identiteits- en modulecontrole gebeurt centraal in de middleware
 * (/admin/sales valt onder de module 'sales').
 */
export default function SalesScriptsPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Belscripts</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Upload je script — de AI deelt het in voor het belscherm: gespreksdelen in het midden,
          bezwaren met je eigen reacties ernaast. De tekst wordt letterlijk overgenomen, nooit herschreven.
        </p>
      </div>
      <ScriptsClient />
    </div>
  )
}
