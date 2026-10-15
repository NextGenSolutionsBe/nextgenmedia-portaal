import { UserCircle } from 'lucide-react'
import { BeveiligingClient } from './beveiliging-client'

export const dynamic = 'force-dynamic'

/**
 * Mijn account → Beveiliging. Voor elk intern account (admin of werknemer),
 * los van modulerechten: iedereen beheert hier zijn EIGEN tweestapsverificatie.
 * De middleware houdt de pagina achter de tweede stap; de API's controleren
 * alles opnieuw.
 */
export default function AccountPage({ searchParams }: { searchParams?: { instellen?: string } }) {
  return (
    <div className="space-y-6 animate-fade-in max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><UserCircle className="h-6 w-6" />Mijn account</h1>
        <p className="text-sm text-gray-500 mt-0.5">Beveiliging van je eigen login.</p>
      </div>
      <BeveiligingClient verplichtMelding={searchParams?.instellen === '1'} />
    </div>
  )
}
