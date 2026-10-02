export const dynamic = 'force-dynamic'

import { FramerManager } from './framer-manager'

export default function FramerManagerPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Framer Manager</h1>
        <p className="text-sm text-gray-500 mt-0.5">Beheer alle Framer-projecten per klant — eigen project URL, API key, collectie en field map. Test, koppel en publiceer veilig.</p>
      </div>
      <FramerManager />
    </div>
  )
}
