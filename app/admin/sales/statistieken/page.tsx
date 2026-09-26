export const dynamic = 'force-dynamic'

import { PrestatiesClient } from './prestaties-client'

/**
 * Statistieken: salesactiviteiten in de pipeline, per medewerker.
 *
 * NIET hetzelfde als "Resultaten" (uren, commissie, uitbetalingen). De cijfers
 * komen uit lib/sales/prestaties.ts (rekenregels, getest) en
 * lib/sales/prestaties-data.ts (enkel betrouwbaar geregistreerde gegevens).
 * Een admin ziet iedereen, het podium en de correcties; een medewerker enkel
 * zijn eigen cijfers (afgedwongen in /api/admin/sales/prestaties).
 */
export default function SalesStatistiekenPage() {
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Statistieken</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Wat er in de pipeline gebeurde: cold calls, afspraken, uitkomsten en faseverplaatsingen — per medewerker.
        </p>
      </div>
      <PrestatiesClient />
    </div>
  )
}
