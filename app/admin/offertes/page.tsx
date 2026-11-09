import { FileSignature } from 'lucide-react'
import { OffertesClient } from './offertes-client'

export const dynamic = 'force-dynamic'

/**
 * Offertes: alles wat verstuurd is (met wanneer de klant het opende en of het
 * geaccepteerd is) en de sjablonen (achterliggende pdf's). Toegang: module
 * Offertes (middleware op /admin/offertes).
 */
export default function OffertesPagina({ searchParams }: { searchParams?: { offerte?: string; tab?: string } }) {
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><FileSignature className="h-6 w-6" />Offertes</h1>
        <p className="text-sm text-gray-500 mt-0.5">Opmaken in de app of een pdf versturen, zien wanneer de klant opent, aanvaardt en tekent. Sjablonen zijn pdf&apos;s die je vervangt als de prijzen veranderen.</p>
      </div>
      <OffertesClient tabStart={searchParams?.tab === 'sjablonen' ? 'sjablonen' : searchParams?.tab === 'instellingen' ? 'instellingen' : 'offertes'} focus={searchParams?.offerte ?? null} />
    </div>
  )
}
