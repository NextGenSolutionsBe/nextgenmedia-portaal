import { FileSignature } from 'lucide-react'
import { OfferteOpmaken } from './opmaken-client'

export const dynamic = 'force-dynamic'

/**
 * Offerte opmaken: klant kiezen, algemene gegevens, enkel de fiches van de
 * diensten die je aanbiedt, het prijsblok. De server maakt er een nette pdf
 * van; versturen gaat daarna via de mail met voorbeeld, zoals elke offerte.
 * ?client=… en ?opdracht=… vullen klant en project in; ?id=… past een concept aan.
 */
export default function OfferteOpmakenPagina({ searchParams }: { searchParams?: { client?: string; opdracht?: string; id?: string } }) {
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><FileSignature className="h-6 w-6" />{searchParams?.id ? 'Offerte aanpassen' : 'Offerte opmaken'}</h1>
        <p className="text-sm text-gray-500 mt-0.5">Algemene gegevens, dan enkel de diensten die je aanbiedt, dan het prijsblok. Je ziet de pdf eerst als voorbeeld; er vertrekt niets tot je de mail verstuurt.</p>
      </div>
      <OfferteOpmaken beginKlant={searchParams?.client ?? null} opdrachtId={searchParams?.opdracht ?? null} offerteId={searchParams?.id ?? null} />
    </div>
  )
}
