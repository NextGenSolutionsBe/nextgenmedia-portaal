'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Contact, LayoutDashboard, ListChecks, CalendarDays, Wallet, Bell } from 'lucide-react'
import { OverzichtTab } from './overzicht-tab'
import { DashboardTab } from './dashboard-tab'
import { UrenTab } from './uren-tab'
import { PlanningTab } from './planning-tab'
import { KostenTab } from './kosten-tab'
import { MeldingenTab } from './meldingen-tab'

const TABS = [
  { key: 'overzicht', label: 'Personeel', icon: Contact },
  { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { key: 'uren', label: 'Urencontrole', icon: ListChecks },
  { key: 'planning', label: 'Planning', icon: CalendarDays },
  { key: 'kosten', label: 'Kosten', icon: Wallet },
  { key: 'meldingen', label: 'Meldingen', icon: Bell },
] as const
type Tab = (typeof TABS)[number]['key']

export function PersoneelClient() {
  const zoek = useSearchParams()
  const router = useRouter()
  const tab = (TABS.some((t) => t.key === zoek.get('tab')) ? zoek.get('tab') : 'overzicht') as Tab
  const kies = (t: Tab) => router.replace(`/admin/personeel${t === 'overzicht' ? '' : `?tab=${t}`}`, { scroll: false })
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Contact className="h-6 w-6" />Personeel</h1>
        <p className="text-sm text-gray-500 mt-0.5">Werknemers, studenten, freelancers en onderaannemers die per uur werken: dossiers, planning, inklokken, urencontrole en personeelskosten.</p>
      </div>
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {TABS.map((t) => {
          const Icon = t.icon
          return <button key={t.key} type="button" onClick={() => kies(t.key)} className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border whitespace-nowrap transition-colors ${tab === t.key ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}><Icon className="h-4 w-4" />{t.label}</button>
        })}
      </div>
      {tab === 'overzicht' && <OverzichtTab />}
      {tab === 'dashboard' && <DashboardTab />}
      {tab === 'uren' && <UrenTab />}
      {tab === 'planning' && <PlanningTab />}
      {tab === 'kosten' && <KostenTab />}
      {tab === 'meldingen' && <MeldingenTab />}
    </div>
  )
}
