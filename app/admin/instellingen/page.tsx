import { redirect } from 'next/navigation'
import { Settings } from 'lucide-react'
import { magInstellingenBeheren } from '@/lib/instellingen/laden'
import { InstellingenClient } from './instellingen-client'

export const dynamic = 'force-dynamic'

/**
 * Centrale instellingen — enkel hoofdbeheerders, of beheerders met het recht
 * "Mag instellingen beheren". De middleware houdt de URL al dicht voor
 * anderen; dit is de tweede grendel.
 */
export default async function InstellingenPage({ searchParams }: { searchParams?: { tab?: string; verborgen?: string } }) {
  const persoon = await magInstellingenBeheren()
  if (!persoon) redirect('/admin')
  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Settings className="h-6 w-6" />Instellingen</h1>
        <p className="text-sm text-gray-500 mt-0.5">Medewerkers, tabbladen, bedrijfsgegevens, facturatie, koppelingen, huisstijl, rechten en het logboek — op één plek.</p>
      </div>
      <InstellingenClient tab={searchParams?.tab ?? 'medewerkers'} verborgen={searchParams?.verborgen ?? null} isAdmin={persoon.isAdmin} />
    </div>
  )
}
