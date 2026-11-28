export const dynamic = 'force-dynamic'

import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalView } from '@/lib/portal-auth'
import { PERIODES, isNetwerk, periodeVan, type PeriodeSoort } from '@/lib/metricool-stats'
import { laadStatistieken } from '@/lib/metricool-stats-server'
import { PortalMetricool } from './portal-metricool'
import { Statistieken } from './statistieken'

export default async function PortalMetricoolPage({ searchParams }: { searchParams: { tab?: string; periode?: string; netwerk?: string } }) {
  const session = await requirePortalView('metricool')

  // Enkel zichtbaar als deze klant aan een Metricool-merk gekoppeld is.
  const admin = createAdminSupabaseClient()
  const { data: client } = await admin
    .from('clients').select('company_name, metricool_blog_id').eq('id', session.clientId).maybeSingle()
  if (!client?.metricool_blog_id) redirect('/portal')

  const tab = searchParams.tab === 'planning' ? 'planning' : 'statistieken'
  const tabs = (
    <div className="flex gap-1 border-b border-gray-200">
      {([['statistieken', 'Statistieken', '/portal/metricool'], ['planning', 'Planning', '/portal/metricool?tab=planning']] as const).map(([k, label, href]) => (
        <Link key={k} href={href} prefetch={false}
          className={`px-3 py-2 text-sm -mb-px border-b-2 ${tab === k ? 'border-gray-900 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800'}`}>
          {label}
        </Link>
      ))}
    </div>
  )

  if (tab === 'planning') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold">Planning</h1>
          <p className="text-sm text-gray-500 mt-0.5">Wanneer je posts online komen, met preview.</p>
        </div>
        {tabs}
        <PortalMetricool />
      </div>
    )
  }

  // Alles komt uit onze databank (de sync haalt het bij Metricool), dus dit laadt snel.
  const vandaag = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Brussels' })
  const soort: PeriodeSoort = PERIODES.some((p) => p.key === searchParams.periode) ? (searchParams.periode as PeriodeSoort) : '30d'
  const netwerk = isNetwerk(searchParams.netwerk) ? searchParams.netwerk : 'alle'
  const data = await laadStatistieken(admin, String(client.metricool_blog_id))

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">Statistieken</h1>
        <p className="text-sm text-gray-500 mt-0.5">Hoe je socialemediakanalen het doen.</p>
      </div>
      {tabs}
      <Statistieken data={data} periode={periodeVan(soort, vandaag)} netwerk={netwerk} />
    </div>
  )
}
