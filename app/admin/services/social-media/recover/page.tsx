export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { RecoverClient } from './recover-client'

export default function RecoverPage() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/admin/services/social-media" className="btn-secondary px-2"><ChevronLeft className="h-4 w-4" /></Link>
        <div>
          <h1 className="text-xl font-bold">Content herstellen</h1>
          <p className="text-sm text-gray-500 mt-0.5">Alle content-items (verbergt niets). Vind verdwenen content terug en koppel wees-items aan de juiste klant.</p>
        </div>
      </div>
      <RecoverClient />
    </div>
  )
}
