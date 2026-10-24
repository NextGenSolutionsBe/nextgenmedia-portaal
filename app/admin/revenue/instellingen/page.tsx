export const dynamic = 'force-dynamic'

import { loadCore, readPeriodParams } from '@/lib/finance-data'
import { FiscalSettingsForm } from '../fiscal-settings-form'

export default async function InstellingenPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { year } = readPeriodParams(await searchParams)
  const c = await loadCore(year)
  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">
        Fiscale parameters, loon en cash-instellingen per boekjaar. Geen hardcoded waarden — alles is aanpasbaar omdat de tarieven jaarlijks wijzigen.
      </p>
      <FiscalSettingsForm settings={c.settings} ebitdaFY={c.ebitdaFY} />
    </div>
  )
}
