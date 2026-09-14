export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { VestingClient } from './vesting-client'

/**
 * Vestigingsprincipe — het contractmodel van de samenwerkingsovereenkomst.
 *
 * De data komt hier binnen; het rekenen gebeurt in lib/vesting.ts en de
 * weergave in vesting-client.tsx. Enkel voor admins: dit is de aandelen-
 * verdeling tussen de zaakvoerders.
 */
export default async function VestingPage() {
  if (!(await requireAdmin())) redirect('/admin')

  const admin = createAdminSupabaseClient()
  const [inst, contracten, wam, kosten, oud] = await Promise.all([
    admin.from('vesting_instellingen').select('*').eq('id', 1).maybeSingle(),
    admin.from('vesting_contracten').select('*').order('ondertekend_op').order('nr'),
    admin.from('vesting_wam').select('*').order('nr'),
    admin.from('vesting_wam_kosten').select('*').order('datum'),
    admin.from('vesting_revenue').select('*').order('entry_date'),
  ])

  return (
    <VestingClient
      instellingenRij={(inst.data ?? null) as Record<string, unknown> | null}
      contractRijen={(contracten.data ?? []) as Record<string, unknown>[]}
      wamRijen={(wam.data ?? []) as Record<string, unknown>[]}
      kostRijen={(kosten.data ?? []) as Record<string, unknown>[]}
      oudeRegistraties={(oud.data ?? []) as Record<string, unknown>[]}
    />
  )
}
