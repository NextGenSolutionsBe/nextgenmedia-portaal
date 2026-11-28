/**
 * Nieuwe werking (28 nov 2026): de Solutions-kaarten die nog op Projecten staan.
 * Per kaart beslis je zelf: verhuizen naar de Pipeline (een deal in de passende
 * fase, de kaart blijft bewaard met een verwijzing) of laten staan. Pure regels,
 * getest in tests/ngs-verkoop.test.ts.
 */
import type { Fase } from '@/lib/ngs/model'

/** Van de status van een kaart naar de fase in de Pipeline. Audit kan niet vanzelf: daar horen gegevens bij. */
export function faseVoorKaart(status: string): Fase {
  switch (status) {
    case 'open': return 'afspraak'
    case 'voorstel_gevraagd': case 'voorstel_bezig': case 'voorstel_klaar': return 'voorstel'
    case 'voorstel_voorgelegd': case 'interesse': case 'contract_verstuurd': case 'wacht': return 'opvolgen'
    case 'getekend': case 'bezig': case 'opgeleverd': case 'te_factureren': case 'factuur_verstuurd': case 'betaald': case 'afgerond': return 'won'
    case 'geen_interesse': case 'geannuleerd': return 'lost'
    default: return 'afspraak'
  }
}

/** De bron van een kaart in de woorden van de Pipeline (zelfde lijst, oude waarden blijven geldig). */
export const bronVoorKaart = (bron: string | null | undefined): string | null => (bron ? bron : null)

export type SolutionsKaart = {
  id: string; titel: string; klant: string | null; status: string; fase: Fase; verantwoordelijke: string | null
  bedrag: number | null; keuze: 'verhuisd' | 'laten' | null; deal_id: string | null
}
