export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { laadNgs } from '@/lib/ngs/server'
import { CijfersClient } from './cijfers-client'

/** NextGen Solutions: omzet en verkoopcijfers uit de eigen pipeline. Toegang: module nextgensolutions. */
export default async function NgsCijfersPagina() {
  const user = await requireStaff()
  if (!user) redirect('/admin')
  const data = await laadNgs(createAdminSupabaseClient(), null)
  const vandaag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return <CijfersClient deals={data.deals} vandaag={vandaag} />
}
