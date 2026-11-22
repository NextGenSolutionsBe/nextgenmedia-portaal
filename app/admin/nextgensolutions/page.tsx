export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createAdminSupabaseClient, requireStaff } from '@/lib/supabase/server'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { laadNgs } from '@/lib/ngs/server'
import { PipelineClient } from './pipeline-client'

/** NextGen Solutions: de eigen pipeline (los van klanten en projecten). Toegang: module nextgensolutions. */
export default async function NgsPipelinePagina({ searchParams }: { searchParams: { deal?: string } }) {
  const user = await requireStaff()
  if (!user) redirect('/admin')
  const ident = await leesAdminIdentiteit().catch(() => null)
  const data = await laadNgs(createAdminSupabaseClient(), ident?.naam || user.email || null)
  const vandaag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  return <PipelineClient begin={data} vandaag={vandaag} openDeal={typeof searchParams.deal === 'string' ? searchParams.deal : null} />
}
