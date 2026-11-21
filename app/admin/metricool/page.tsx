export const dynamic = 'force-dynamic'

import { MetricoolClient } from './metricool-client'

export default function MetricoolPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">Metricool</h1>
        <p className="text-sm text-gray-500 mt-0.5">Enkel lezen. Plannen en goedkeuren gebeurt in Metricool.</p>
      </div>
      <MetricoolClient />
    </div>
  )
}
