export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { laadLevering } from '@/lib/ngs/levering-server'
import { LeveringClient } from './levering-client'
import { getActor, actorCanSee } from '@/lib/actor-modules'

/** NextGenSolutions: de levering na Closed Won (projecten per fase en Care). Toegang: module ngs_levering of nextgensolutions. */
export default async function NgsLeveringPagina({ searchParams }: { searchParams: { project?: string; tab?: string } }) {
  const user = await requireStaff()
  if (!user) redirect('/admin')
  const [data, actor] = await Promise.all([laadLevering(createAdminSupabaseClient()), getActor()])
  // Wie enkel Levering mag (Uitvoerder Solutions) ziet geen tabbladen Pipeline en Cijfers.
  const verkoop = !!actor && actorCanSee(actor, 'nextgensolutions')
  return <LeveringClient begin={data} verkoop={verkoop} openProject={typeof searchParams.project === 'string' ? searchParams.project : null} tab={searchParams.tab === 'care' ? 'care' : searchParams.tab === 'audits' ? 'audits' : 'projecten'} />
}
