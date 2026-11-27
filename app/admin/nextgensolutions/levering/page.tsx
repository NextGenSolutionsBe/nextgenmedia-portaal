export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { laadLevering } from '@/lib/ngs/levering-server'
import { LeveringClient } from './levering-client'

/** NextGenSolutions: de levering na Closed Won (projecten per fase en Care). Toegang: module nextgensolutions. */
export default async function NgsLeveringPagina({ searchParams }: { searchParams: { project?: string; tab?: string } }) {
  const user = await requireStaff()
  if (!user) redirect('/admin')
  const data = await laadLevering(createAdminSupabaseClient())
  return <LeveringClient begin={data} openProject={typeof searchParams.project === 'string' ? searchParams.project : null} tab={searchParams.tab === 'care' ? 'care' : 'projecten'} />
}
