export const dynamic = 'force-dynamic'

import { MetricoolClient } from './metricool-client'

export default function MetricoolPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Metricool</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Read-only overzicht van geplande posts per klant. Plannen en goedkeuren gebeurt in Metricool zelf.
        </p>
      </div>
      <MetricoolClient />
    </div>
  )
}
