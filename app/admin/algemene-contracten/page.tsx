import { redirect } from 'next/navigation'
import { createAdminSupabaseClient, requireAdmin } from '@/lib/supabase/server'
import { laadOverzicht } from '@/lib/algemene-contracten/server'
import type { AlgemeenContract, Map } from '@/lib/algemene-contracten/model'
import { AcOverzicht } from './overzicht'

export const dynamic = 'force-dynamic'

/** Algemene contracten van NextGenMedia zelf (huur, verzekeringen, NDA's …): enkel de zaakvoerders. */
export default async function AlgemeneContractenPagina({ searchParams }: { searchParams: Promise<{ map?: string }> }) {
  if (!(await requireAdmin())) redirect('/admin')
  let mappen: Map[] = [], contracten: AlgemeenContract[] = [], fout: string | null = null
  try { ({ mappen, contracten } = await laadOverzicht(createAdminSupabaseClient())) } catch (e) { fout = e instanceof Error ? e.message : 'Laden mislukt' }
  const map = (await searchParams).map
  return <AcOverzicht mappen={mappen} contracten={contracten} fout={fout} beginMap={map && /^[0-9a-f-]{36}$/i.test(map) ? map : null} />
}
