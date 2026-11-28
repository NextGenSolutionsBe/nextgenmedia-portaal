// Mag een factuur die aan een contract hangt al verstuurd worden? Pure module
// (client-safe, testbaar). Eén regel voor de planner, het itemdetail en het
// contractdetail.

import { canonicalStatus, isNietDoorgegaan } from '@/lib/contract-status'

export type ContractStand = 'vrij' | 'wacht' | 'vervallen'

/**
 * Een factuur van een contract komt pas bij "te factureren" zodra het contract
 * getekend is:
 *  · geen contract (of een onbekend contract) → vrij
 *  · getekend → vrij
 *  · geannuleerd, niet geaccepteerd of vervangen → vervallen: wordt niet verstuurd
 *  · al de rest (klaar voor verzenden, verzonden, geopend, verlopen…) → wacht op de handtekening
 * Een factuur die al verstuurd is, blijft verstuurd; dit gaat enkel over wat nog moet vertrekken.
 */
export function contractStand(contractStatus: string | null | undefined): ContractStand {
  if (contractStatus === null || contractStatus === undefined || contractStatus === '') return 'vrij'
  if (canonicalStatus(contractStatus) === 'getekend') return 'vrij'
  if (isNietDoorgegaan(contractStatus)) return 'vervallen'
  return 'wacht'
}
