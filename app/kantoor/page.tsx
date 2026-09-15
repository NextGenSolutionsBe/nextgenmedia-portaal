export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { resolveKantoorSessie } from '@/lib/kantoor/auth'
import { KantoorClient } from './kantoor-client'

/**
 * Het Kantoor voor PARTNERS: een eigen, kale schil buiten de adminshell.
 * Wie hier geen lidmaatschap heeft, hoort hier niet — dan terug naar login.
 */
export default async function KantoorPage() {
  const sessie = await resolveKantoorSessie()
  if (!sessie) redirect('/login')

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-[1100px] mx-auto px-4 py-8">
        <KantoorClient />
      </div>
    </div>
  )
}
