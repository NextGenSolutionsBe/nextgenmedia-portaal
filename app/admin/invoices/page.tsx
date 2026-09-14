export const dynamic = 'force-dynamic'

import { InvoicesPanel } from './invoices-panel'

// ?maand=YYYY-MM opent die maand meteen (zo linkt o.a. Vesting naar een WAM-factuur).
export default function InvoicesPage({ searchParams }: { searchParams?: { maand?: string } }) {
  const maand = /^\d{4}-\d{2}$/.test(searchParams?.maand ?? '') ? searchParams!.maand : undefined
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Facturen</h1>
        <p className="text-sm text-gray-500 mt-0.5">Interne facturatie-opvolging en koppeling met de omzetmodule. Geen automatische facturen.</p>
      </div>
      <InvoicesPanel initialMonth={maand} />
    </div>
  )
}
