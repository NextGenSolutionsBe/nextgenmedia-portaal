import { redirect } from 'next/navigation'
import { Suspense } from 'react'
import { magIk } from '@/lib/instellingen/laden'
import { PersoneelClient } from './personeel-client'

export const dynamic = 'force-dynamic'

/** Personeel: dossiers, dashboard, urencontrole, planning, kosten en meldingen. */
export default async function PersoneelPage() {
  const persoon = await magIk('personeel', 'bekijken')
  if (!persoon) redirect('/admin')
  // Accounts en rechten (de vroegere pagina Werknemers) blijven voor hoofdbeheerders.
  return <Suspense><PersoneelClient isAdmin={persoon.isAdmin} /></Suspense>
}
