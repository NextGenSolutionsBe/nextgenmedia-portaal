'use client'

import { useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarDays, List, Globe } from 'lucide-react'
import { focusRing } from '@/app/admin/materiaal/dialogen'
import { MeetingsClient } from './meetings-client'
import { KlantboekingenTab } from './klantboekingen'

export type InplannerTab = 'overzicht' | 'agenda' | 'klantboekingen'

const LABEL: Record<InplannerTab, { label: string; icoon: typeof List; uitleg: string }> = {
  overzicht: { label: 'Overzicht', icoon: List, uitleg: 'Alle meetings: intern gepland, door klanten geboekt en verkoopafspraken.' },
  agenda: { label: 'Verkoopagenda', icoon: CalendarDays, uitleg: 'Boek op een vrij (wit) moment voor een lead uit de pipeline of Focusmode. Agenda’s koppelen en werkuren instellen doe je hier ook.' },
  klantboekingen: { label: 'Klantboekingen', icoon: Globe, uitleg: 'De link waarmee klanten zelf een gratis meeting van 30 minuten boeken.' },
}

/** Meeting Inplanner — één module, drie weergaven. */
export function MeetingInplanner({ tabs, startTab, agenda }: { tabs: InplannerTab[]; startTab: InplannerTab; agenda: ReactNode }) {
  const router = useRouter()
  const [tab, setTab] = useState<InplannerTab>(startTab)
  const kies = (t: InplannerTab) => {
    setTab(t)
    router.replace(t === 'overzicht' ? '/admin/meetings' : `/admin/meetings?tab=${t}`, { scroll: false })
  }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold">Meeting Inplanner</h1>
        <p className="text-sm text-gray-500">{LABEL[tab].uitleg}</p>
      </div>
      {tabs.length > 1 && (
        <div role="tablist" aria-label="Meeting Inplanner" className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1 max-w-full overflow-x-auto">
          {tabs.map((t) => {
            const I = LABEL[t].icoon
            return (
              <button key={t} role="tab" aria-selected={tab === t} type="button" onClick={() => kies(t)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap ${tab === t ? 'bg-black text-white' : 'text-gray-700 hover:bg-white'} ${focusRing}`}>
                <I className="h-4 w-4" aria-hidden />{LABEL[t].label}
              </button>
            )
          })}
        </div>
      )}
      {tab === 'overzicht' && <MeetingsClient />}
      {tab === 'agenda' && agenda}
      {tab === 'klantboekingen' && <KlantboekingenTab />}
    </div>
  )
}
