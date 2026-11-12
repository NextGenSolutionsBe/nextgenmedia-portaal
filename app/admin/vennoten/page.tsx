export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { laadVennotenData } from '@/lib/vennoot-uitgaven-server'
import { VENNOTEN, type Vennoot } from '@/lib/vennoot-uitgaven'
import { VennotenClient } from './vennoten-client'

/**
 * Uitgaven vennoten: aankopen op de zaak met een persoonlijk voordeel voor één
 * vennoot (budget per maand, wat je niet gebruikt spaar je). Enkel admins.
 */
export default async function VennotenPagina({ searchParams }: { searchParams: { vennoot?: string; regels?: string; akkoord?: string } }) {
  const ik = await requireAdmin()
  if (!ik) redirect('/admin')
  const data = await laadVennotenData(createAdminSupabaseClient(), ik.id)
  const vandaag = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const vennoot = VENNOTEN.includes(searchParams.vennoot as Vennoot) ? (searchParams.vennoot as Vennoot) : null
  return <VennotenClient data={data} vandaag={vandaag} beginVennoot={vennoot} regelsOpen={searchParams.regels === '1'} akkoordFilter={searchParams.akkoord === '1'} />
}
