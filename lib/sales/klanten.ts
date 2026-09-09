import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { nieuweKlantIndex, voegKlantToe, type KlantIndex } from '@/lib/sales/dedupe'

/**
 * De klantindex vullen uit de database. Het herkennen zelf staat in
 * lib/sales/dedupe.ts — puur, en dus los getest.
 *
 * Twee bronnen, allebei nodig:
 *  · public.clients — klanten met een portaaldossier;
 *  · leads die al op 'won' staan — klanten zonder portaal, of pas gewonnen.
 */
export async function laadKlantIndex(salesClientId: string): Promise<KlantIndex> {
  const index = nieuweKlantIndex()
  const admin = createAdminSupabaseClient()

  // 1) Klanten met een portaaldossier. `website` bestaat mogelijk niet op elke
  //    installatie; valt de kolom weg, dan blijft de naam bruikbaar.
  let klanten: { company_name: string | null; website?: string | null }[] = []
  {
    const breed = await admin.from('clients').select('company_name, website')
    if (breed.error) {
      const smal = await admin.from('clients').select('company_name')
      klanten = (smal.data ?? []) as { company_name: string | null }[]
    } else {
      klanten = (breed.data ?? []) as { company_name: string | null; website: string | null }[]
    }
  }
  for (const k of klanten) voegKlantToe(index, k.company_name, k.website ?? null)

  // 2) Gewonnen leads — ook klant.
  const { data: gewonnen } = await admin
    .from('sales_leads')
    .select('sales_companies ( name, website )')
    .eq('sales_client_id', salesClientId)
    .eq('stage_key', 'won')
    .limit(5000)
  for (const rij of (gewonnen ?? []) as unknown as { sales_companies: { name: string | null; website: string | null } | null }[]) {
    voegKlantToe(index, rij.sales_companies?.name, rij.sales_companies?.website)
  }

  return index
}

export { isBekendeKlant, LEGE_KLANTINDEX, type KlantIndex } from '@/lib/sales/dedupe'
