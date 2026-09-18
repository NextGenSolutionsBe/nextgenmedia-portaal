export const dynamic = 'force-dynamic'

import { StatsClient } from './stats-client'

/**
 * Statistieken van het appointment setten.
 *
 * NIET hetzelfde als "Resultaten". Dat scherm gaat over geld — gewerkte uren,
 * commissie en wat er uitbetaald moet worden. Dit gaat over prestaties: waar
 * lekt de trechter, wie zet om, welke sector levert op. Twee vragen die je niet
 * in één tabel beantwoordt zonder allebei onleesbaar te maken.
 *
 * De identiteits- en modulecontrole gebeurt centraal in de middleware; de route
 * beperkt daarnaast wat een setter over anderen mag zien.
 */
export default function SalesStatistiekenPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Statistieken</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Conversie van gesprek tot getekend contract, per setter, sector en bron.
          Een afspraak telt mee in de periode waarin ze gepland stond.
        </p>
      </div>
      <StatsClient />
    </div>
  )
}
