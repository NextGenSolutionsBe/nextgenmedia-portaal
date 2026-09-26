export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { magIk } from '@/lib/instellingen/laden'
import { VerzendingClient } from './verzending-client'

/** Eenmalige archiefverzending van alle contracten. Alleen voor wie contracten mag aanpassen. */
export default async function Page() {
  if (!(await magIk('contracts', 'bekijken'))) redirect('/admin')
  return <VerzendingClient />
}
