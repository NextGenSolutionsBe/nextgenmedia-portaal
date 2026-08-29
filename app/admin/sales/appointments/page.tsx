export const dynamic = 'force-dynamic'

import { getOrCreateSalesOrg } from '@/lib/sales/service'
import { listPipelines } from '@/lib/sales/pipelines'
import { requireAdmin } from '@/lib/supabase/server'
import { SalesCalendar } from './calendar'

// Appointment setting — sleep een afspraak in de agenda van Bram of Marco.
export default async function SalesAppointmentsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
  const [pipeline, pipelines, admin] = await Promise.all([
    getOrCreateSalesOrg(), listPipelines(), requireAdmin(),
  ])

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Appointment setting</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Kies wiens agenda je bekijkt en sleep op een vrij (wit) moment om een afspraak te boeken.
        </p>
      </div>

      <SalesCalendar
        client={{
          id: pipeline.id,
          name: pipeline.name,
          timezone: pipeline.timezone,
          slot_interval_min: pipeline.slot_interval_min,
          default_duration_min: pipeline.default_duration_min,
        }}
        pipelines={pipelines.map((p) => ({ id: p.id, key: p.key, name: p.name }))}
        isAdmin={!!admin}
        initialLeadId={sp.lead}
      />
    </div>
  )
}
