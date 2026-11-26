export const dynamic = 'force-dynamic'

import { OpdrachtenClient } from './opdrachten-client'
import { leesPersoon } from '@/lib/instellingen/laden'
import { leesBedrijfFilter } from '@/lib/bedrijven/weergave'

/**
 * Opdrachten — werk dat binnenkomt en opgevolgd moet worden.
 *
 * De identiteits- en modulecontrole gebeurt centraal in de middleware
 * (pathToModule op /admin-paden), dus hier geen losse rolcheck: dat zou een
 * tweede plek zijn waar rechten geregeld worden.
 */
export default async function OpdrachtenPage() {
  // De weergave in de zijbalk (Alles / Media / Solutions) is de startfilter "Bedrijf".
  const persoon = await leesPersoon()
  const weergave = await leesBedrijfFilter(persoon?.userId)
  return <OpdrachtenClient startBedrijf={weergave === 'alles' ? '' : weergave} />
}
