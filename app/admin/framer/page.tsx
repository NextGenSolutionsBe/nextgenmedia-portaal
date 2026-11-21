export const dynamic = 'force-dynamic'

import { FramerManager } from './framer-manager'

export default function FramerManagerPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">Framer Manager</h1>
        <p className="text-sm text-gray-500 mt-0.5">Framer-projecten per klant koppelen en publiceren.</p>
      </div>
      <FramerManager />
    </div>
  )
}
