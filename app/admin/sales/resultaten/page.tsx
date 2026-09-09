export const dynamic = 'force-dynamic'

import { ResultsClient } from './results-client'
import { SetterTarieven } from './setter-tarieven'
import { requireAdmin } from '@/lib/supabase/server'

// Resultaten van de appointment setters: gebelde uren, afspraken, gewonnen
// deals, commissie en wat er uitbetaald moet worden.
export default async function SalesResultsPage() {
  // Tarieven bepalen wat er uitbetaald wordt: enkel voor admins.
  const isAdmin = !!(await requireAdmin())

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Resultaten</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Gebelde uren, geboekte afspraken en verdiensten per maand.
        </p>
      </div>
      <ResultsClient />
      {isAdmin && <SetterTarieven />}
    </div>
  )
}
