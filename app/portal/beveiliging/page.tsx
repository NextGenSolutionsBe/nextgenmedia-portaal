export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'
import { resolvePortalSession } from '@/lib/portal-auth'
import { PortaalBeveiliging } from './beveiliging-client'

/**
 * Beveiliging van het EIGEN account (eigenaar of subaccount). Geen portaalmodule:
 * elke ingelogde portaalgebruiker beheert enkel zijn eigen tweestapsverificatie.
 * Alle acties lopen via /api/auth/2fa/* en gelden altijd voor de ingelogde gebruiker.
 */
export default async function PortaalBeveiligingPage() {
  const session = await resolvePortalSession()
  if (!session || !session.active) redirect('/login')
  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-[#fff848] flex items-center justify-center"><ShieldCheck className="h-4 w-4 text-black" /></div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Beveiliging</h1>
          <p className="text-sm text-gray-500">Bescherm je account extra met tweestapsverificatie.</p>
        </div>
      </div>
      <PortaalBeveiliging />
    </div>
  )
}
