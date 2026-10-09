export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MaandplanningCalendar } from './maandplanning-calendar'
import { MaandKlanten } from './maand-klanten'

/**
 * Maandplanning: welke fase op welke werkdag valt. Dit is ook de bron van de
 * reeksen (1/2/3) in de Contentplanning — daar wordt het dagelijkse werk gepland.
 */
export default function MaandplanningPage() {
  return (
    <div className="space-y-8">
      <Link href="/admin/contentplanning" prefetch={false} className="text-xs text-gray-500 hover:text-black inline-flex items-center gap-1"><ArrowLeft className="h-3.5 w-3.5" />Terug naar de Contentplanning · de fases hieronder bepalen de reeksen per dag</Link>
      <MaandplanningCalendar />
      <Suspense fallback={<div className="card-base text-sm text-gray-400">Klanten laden…</div>}>
        <MaandKlanten />
      </Suspense>
    </div>
  )
}
