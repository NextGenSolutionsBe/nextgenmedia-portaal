export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { magIk } from '@/lib/instellingen/laden'
import { ContentplanningClient } from './contentplanning-client'

/**
 * Contentplanning: de Maandplanning uitgebreid tot één werkruimte voor de
 * contentworkflow (Dag · Week · Maand · Klantenbord). Module "Informatief".
 */
export default async function ContentplanningPage() {
  if (!(await magIk('info', 'bekijken'))) redirect('/admin')
  return <ContentplanningClient />
}
