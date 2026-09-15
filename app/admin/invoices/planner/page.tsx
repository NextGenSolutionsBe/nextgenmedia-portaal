export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { ArrowLeft, CalendarDays } from 'lucide-react'
import { PlannerClient } from './planner-client'

/**
 * Facturatieplanner: dashboard + kalender + lijst over alle geplande
 * facturatiemomenten (eenmalig, terugkerend, contract, WAM). De gegevens komen
 * uit één centrale bron (/api/admin/invoices/planner), per zichtbare periode.
 */
export default function FacturatiePlannerPage({ searchParams }: { searchParams?: { categorie?: string; weergave?: string; datum?: string } }) {
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <Link href="/admin/invoices" prefetch={false} className="text-xs text-gray-500 hover:text-black inline-flex items-center gap-1 mb-1"><ArrowLeft className="h-3.5 w-3.5" />Terug naar Facturen</Link>
        <h1 className="text-2xl font-bold flex items-center gap-2"><CalendarDays className="h-6 w-6" />Facturatieplanner</h1>
        <p className="text-sm text-gray-500 mt-0.5">Wat moet er wanneer gefactureerd worden — eenmalig, terugkerend, uit contracten en uit de WAM-portefeuille. Alle bedragen exclusief btw, tenzij anders vermeld.</p>
      </div>
      <PlannerClient startCategorie={searchParams?.categorie ?? null} startWeergave={searchParams?.weergave ?? null} startDatum={searchParams?.datum ?? null} />
    </div>
  )
}
