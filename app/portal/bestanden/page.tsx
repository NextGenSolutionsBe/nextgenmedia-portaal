export const dynamic = 'force-dynamic'

import { FolderUp } from 'lucide-react'
import { requirePortalView, sessionCan } from '@/lib/portal-auth'
import { MappenOverzicht } from './mappen-overzicht'
import { laadOverzicht } from './data'

/**
 * De aanleverplek voor klanten, met mappen als startpunt.
 *
 * Bewust een eigen scherm en niet iets onder Social Media. Materiaal wordt
 * meestal aangeleverd lang voordat duidelijk is bij welke post het hoort — en
 * soms hoort het bij niets. Zou dit onder de contentkalender hangen, dan moest
 * een klant eerst een post aanwijzen voordat hij een foto kwijt kon.
 */
export default async function PortalBestandenPage() {
  const session = await requirePortalView('files')
  const magBeheren = sessionCan(session, 'files', 'upload')
  const overzicht = await laadOverzicht(session.clientId)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <FolderUp className="h-6 w-6" />Bestanden
        </h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Maak een map per shoot of onderwerp en sleep er in één keer al je foto&apos;s in.
          Vertel er kort bij wat we zien — dan weten we waarvoor we het kunnen gebruiken.
        </p>
      </div>

      {overzicht.nogNietKlaar ? (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
          Deze module is nog niet klaar voor gebruik — de migratie moet nog draaien.
        </p>
      ) : (
        <MappenOverzicht
          mappen={overzicht.mappen}
          losAantal={overzicht.losAantal}
          losVoorbeeld={overzicht.losVoorbeeld}
          magBeheren={magBeheren}
        />
      )}
    </div>
  )
}
