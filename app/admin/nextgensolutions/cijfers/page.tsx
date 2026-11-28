export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { laadNgs } from '@/lib/ngs/server'
import { gefactureerdSolutions } from '@/lib/ngs/levering-server'
import { gemiddeldPerWorkflow } from '@/lib/ngs/audit-server'
import { CijfersClient } from './cijfers-client'

/** NextGen Solutions: omzet en verkoopcijfers uit de eigen pipeline. Toegang: module nextgensolutions. */
export default async function NgsCijfersPagina() {
  const user = await requireStaff()
  if (!user) redirect('/admin')
  const admin = createAdminSupabaseClient()
  // Pipeline = prognose; gefactureerd = de facturen met bedrijf NextGenSolutions (fase 5, punt 29).
  const [data, gefactureerd, bespaard] = await Promise.all([laadNgs(admin, null), gefactureerdSolutions(admin), gemiddeldPerWorkflow(admin)])
  const vandaag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return <CijfersClient deals={data.deals} vandaag={vandaag} gefactureerd={gefactureerd} bespaard={bespaard} />
}
