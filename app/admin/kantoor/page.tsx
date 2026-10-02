export const dynamic = 'force-dynamic'

import { KantoorClient } from '@/app/kantoor/kantoor-client'
import { PartnerBeheer } from './partner-beheer'

/**
 * Het Kantoor binnen de adminshell — hetzelfde overzicht als partners zien,
 * plus het beheer van de bedrijven en hun logins.
 *
 * Identiteit en module worden centraal in de middleware gecontroleerd
 * (pathToModule op /admin-paden); hier bewust geen tweede rolcheck.
 */
export default function AdminKantoorPage() {
  return (
    <div className="space-y-8">
      <KantoorClient />
      <PartnerBeheer />
    </div>
  )
}
