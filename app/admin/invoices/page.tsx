export const dynamic = 'force-dynamic'

import { InvoicesPanel } from './invoices-panel'

export default function InvoicesPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Facturen</h1>
        <p className="text-sm text-gray-500 mt-0.5">Interne facturatie-opvolging en koppeling met de omzetmodule. Geen automatische facturen.</p>
      </div>
      <InvoicesPanel />
    </div>
  )
}
