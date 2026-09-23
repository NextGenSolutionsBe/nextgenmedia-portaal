export const dynamic = 'force-dynamic'

import { PlannerClient } from './planner/planner-client'

/**
 * Facturen = interne facturatieplanner: één lijst (en kalender) van alles wat
 * nog opgemaakt en verstuurd moet worden, voor welke klant, wat, voor hoeveel,
 * wanneer, en wanneer het geld naar verwachting binnenkomt. Geen boekhouding.
 * ?maand=YYYY-MM opent die maand meteen (zo linkt o.a. Vesting naar een WAM-factuur).
 */
export default function InvoicesPage({ searchParams }: { searchParams?: { maand?: string; weergave?: string; categorie?: string; factuur?: string } }) {
  const maand = /^\d{4}-\d{2}$/.test(searchParams?.maand ?? '') ? `${searchParams!.maand}-01` : null
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Facturen</h1>
        <p className="text-sm text-gray-500 mt-0.5">Interne facturatieplanner: wat moet wanneer voor wie gefactureerd worden. De boekhouding zelf gebeurt buiten de app.</p>
      </div>
      <PlannerClient startCategorie={searchParams?.categorie ?? null} startWeergave={searchParams?.weergave ?? 'lijst'} startDatum={maand} startFactuur={/^[0-9a-f-]{36}$/i.test(searchParams?.factuur ?? '') ? searchParams!.factuur! : null} />
    </div>
  )
}
