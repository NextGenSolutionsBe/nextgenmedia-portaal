export const dynamic = 'force-dynamic'

import { OpdrachtenClient } from './opdrachten-client'

/**
 * Opdrachten — werk dat binnenkomt en opgevolgd moet worden.
 *
 * De identiteits- en modulecontrole gebeurt centraal in de middleware
 * (pathToModule op /admin-paden), dus hier geen losse rolcheck: dat zou een
 * tweede plek zijn waar rechten geregeld worden.
 */
export default function OpdrachtenPage() {
  return <OpdrachtenClient />
}
