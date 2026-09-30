import 'server-only'
import { leesInstellingen } from '@/lib/instellingen/laden'
import { STANDAARD_VERKOOP } from '@/lib/instellingen/model'

/** De keuzelijst met verkoopverantwoordelijken (Instellingen → Verkoop). */
export async function leesVerantwoordelijken(): Promise<string[]> {
  try {
    const inst = await leesInstellingen()
    return inst.verkoop?.verantwoordelijken?.length ? inst.verkoop.verantwoordelijken : [...STANDAARD_VERKOOP.verantwoordelijken]
  } catch {
    return [...STANDAARD_VERKOOP.verantwoordelijken]
  }
}

/** Naam uit een verzoek: ingekort (max. 60), leeg = null. */
export function naamOfNull(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 60) : ''
  return s || null
}
