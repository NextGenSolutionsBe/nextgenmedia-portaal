export const dynamic = 'force-dynamic'

import { Suspense } from 'react'
import { MaandplanningCalendar } from './maandplanning-calendar'
import { MaandKlanten } from './maand-klanten'

export default function MaandplanningPage() {
  return (
    <div className="space-y-8">
      <MaandplanningCalendar />
      <Suspense fallback={<div className="card-base text-sm text-gray-400">Klanten laden…</div>}>
        <MaandKlanten />
      </Suspense>
    </div>
  )
}
