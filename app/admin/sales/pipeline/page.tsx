export const dynamic = 'force-dynamic'

import { listPipelines } from '@/lib/sales/pipelines'
import { PipelineClient } from './pipeline-client'

// Pipeline — één bestand voor beide merken. Onze setters bellen hieruit en
// boeken in de agenda van Bram of Marco. Elke lead draagt zelf zijn merk(en);
// bovenaan filter je desgewenst op één bedrijf.
export default async function SalesPipelinePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams
  const pipelines = await listPipelines()
  // Leeg = alle merken samen. Eén bestand is het uitgangspunt; een merk kiezen
  // is een filter dat je zelf aanzet (of dat via ?pipeline meekomt).
  const initial = pipelines.find((p) => p.id === sp.pipeline)?.id ?? ''

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Pipeline</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Alle prospects, voor beide merken. Interesse? Boek de afspraak via de knop bij de lead.
        </p>
      </div>
      <PipelineClient
        pipelines={pipelines.map((p) => ({ id: p.id, name: p.name, key: p.key }))}
        initialPipelineId={initial}
      />
    </div>
  )
}
