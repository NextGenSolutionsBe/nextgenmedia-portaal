// Personeel ↔ Financiën — kostenposten. Puur en testbaar.
//
// Drie soorten kost, strikt gescheiden:
//  · verwacht   — ingeplande werkblokken (nog niet gepresteerd)
//  · voorlopig  — ingediende uren die nog niet goedgekeurd zijn
//  · definitief — goedgekeurde uren; ENKEL deze gaan als kost naar Financiën
//
// Per medewerker en maand bestaat hooguit één actuele definitieve post. Wijzigt
// het bedrag (bv. een goedgekeurde sessie wordt gecorrigeerd), dan komt er een
// nieuwe versie bij; de vorige blijft bewaard met een verwijzing — zo is elke
// financiële correctie traceerbaar en telt niets dubbel.

import { rond2, type PeriodeKost } from './kost'

export type KostenSoort = 'verwacht' | 'voorlopig' | 'definitief'
export const KOSTEN_SOORT: Record<KostenSoort, { label: string; chip: string; uitleg: string }> = {
  verwacht: { label: 'Verwacht', chip: 'bg-blue-50 text-blue-800 border-blue-200', uitleg: 'Op basis van ingeplande uren' },
  voorlopig: { label: 'Voorlopig', chip: 'bg-amber-50 text-amber-800 border-amber-200', uitleg: 'Ingediende uren, nog niet goedgekeurd' },
  definitief: { label: 'Definitief', chip: 'bg-green-50 text-green-800 border-green-200', uitleg: 'Goedgekeurde uren — geboekt in Financiën' },
}

/** De unieke sleutel van een geboekte kost in Financiën (cost_entries.bron_sleutel). */
export const bronSleutel = (personeelId: string, periode: string) => `personeel:${personeelId}:${periode}`

export type ActuelePost = { id: string; versie: number; bedrag: number; uren: number; cost_entry_id: string | null }

export type Boekingsbesluit =
  | { actie: 'geen'; reden: string }
  | { actie: 'nieuw'; versie: 1; bedrag: number; uren: number }
  | { actie: 'correctie'; versie: number; bedrag: number; uren: number; vorigeId: string; verschil: number }
  | { actie: 'intrekken'; vorigeId: string; verschil: number }

/**
 * Wat moet er geboekt worden voor deze medewerker en maand?
 *  · nog niets geboekt en een kost > 0 → nieuwe post (versie 1)
 *  · bedrag of uren gewijzigd → correctie (nieuwe versie; de oude blijft)
 *  · alles teruggedraaid (0 goedgekeurde uren) → de post intrekken
 *  · niets veranderd → geen boeking (voorkomt dubbele kosten)
 */
export function besluitBoeking(definitief: Pick<PeriodeKost, 'totaal' | 'uren'>, actueel: ActuelePost | null): Boekingsbesluit {
  const bedrag = rond2(definitief.totaal), uren = rond2(definitief.uren)
  if (!actueel) {
    if (bedrag <= 0 && uren <= 0) return { actie: 'geen', reden: 'Geen goedgekeurde uren in deze maand.' }
    return { actie: 'nieuw', versie: 1, bedrag, uren }
  }
  if (Math.abs(actueel.bedrag - bedrag) < 0.005 && Math.abs(actueel.uren - uren) < 0.005) return { actie: 'geen', reden: 'Al geboekt; niets gewijzigd.' }
  if (bedrag <= 0 && uren <= 0) return { actie: 'intrekken', vorigeId: actueel.id, verschil: rond2(-actueel.bedrag) }
  return { actie: 'correctie', versie: actueel.versie + 1, bedrag, uren, vorigeId: actueel.id, verschil: rond2(bedrag - actueel.bedrag) }
}

/** Laatste dag van een maand ('YYYY-MM' → 'YYYY-MM-DD'), de boekdatum van een kostenpost. */
export function boekdatum(periode: string): string {
  const [j, m] = periode.split('-').map(Number)
  return `${periode}-${String(new Date(Date.UTC(j, m, 0)).getUTCDate()).padStart(2, '0')}`
}

/** Omschrijving van de kost in Financiën. */
export function kostNaam(naam: string, periode: string): string {
  const [j, m] = periode.split('-')
  const maanden = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
  return `Personeel — ${naam} — ${maanden[Number(m) - 1]} ${j}`
}

/** Verschil tussen planning en werkelijkheid (positief = meer kost dan verwacht). */
export function verschil(verwacht: number, werkelijk: number): { bedrag: number; pct: number | null } {
  const bedrag = rond2(werkelijk - verwacht)
  return { bedrag, pct: verwacht > 0 ? Math.round((bedrag / verwacht) * 1000) / 10 : null }
}
