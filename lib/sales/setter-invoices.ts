import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'

/**
 * Opruimen van automatisch aangemaakte setterfacturen.
 *
 * Even is geprobeerd om de afrekeningen van een appointment setter als factuur
 * in het facturenscherm te zetten. Dat was verkeerd: dat scherm gaat over wat
 * WIJ aan klanten factureren — onze omzet. Een setter factureert ons, dat is
 * een kost, en die staat bij Verkoop → Resultaten en in Financiën → Kosten.
 *
 * Deze functie haalt enkel de rijen weg die de app zelf had aangemaakt
 * (source = 'auto' én gekoppeld aan een setter). Handmatig ingevoerde facturen
 * blijven onaangeroerd.
 */
export async function removeAutoSetterInvoices(): Promise<number> {
  try {
    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('invoices')
      .delete()
      .eq('source', 'auto')
      .not('setter_id', 'is', null)
      .select('id')
    return (data ?? []).length
  } catch {
    // Kolommen bestaan niet (of er valt niets op te ruimen) → niets aan de hand.
    return 0
  }
}
