export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { laadVestingData, naarWeergave } from '@/lib/vesting-data-server'
import { laadVestingRegels } from '@/lib/vesting-regels-server'
import { VestingClient } from './vesting-client'
import { VestingOverzicht } from './overzicht/vesting-overzicht'

/**
 * Vestigingsprincipe — het contractmodel van de samenwerkingsovereenkomst.
 *
 * Standaard het overzicht: aandelen, welke contracten meetellen, hun kosten en
 * wie getekend heeft. `?weergave=uitgebreid` toont het volledige rekenblad met
 * facturen, WAM-termijnen en instellingen. De data en berekening komen uit één
 * plek (lib/vesting-data-server.ts → lib/vesting.ts). Enkel voor admins.
 */
export default async function VestingPage({ searchParams }: { searchParams: { weergave?: string; tekenen?: string; regels?: string } }) {
  const actor = await requireAdmin()
  if (!actor) redirect('/admin')

  const data = await laadVestingData(createAdminSupabaseClient())

  if (searchParams.weergave === 'uitgebreid') {
    const r = data.ruw
    return (
      <VestingClient
        instellingenRij={r.instellingen}
        contractRijen={r.contracten}
        wamRijen={r.wam}
        kostRijen={r.kosten}
        oudeRegistraties={r.oud}
        termijnRijen={r.wamTermijnen}
        contractTermijnRijen={r.contractTermijnen}
        facturen={r.facturen}
        nietMeetellen={r.nietMeetellen}
        wamGekoppeld={r.wamGekoppeld}
        moduleContracten={r.moduleContracten}
        klanten={r.klanten}
      />
    )
  }

  const regels = await laadVestingRegels(createAdminSupabaseClient(), actor.id)
  return <VestingOverzicht data={naarWeergave(data, actor.id)} tekenen={searchParams.tekenen === '1'} regels={regels} regelsOpen={searchParams.regels === '1'} />
}
