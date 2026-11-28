'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle } from 'lucide-react'
import { PROJECT_FASES, type ProjectFase } from '@/lib/ngs/levering'
import type { LeveringData } from '@/lib/ngs/levering-server'
import { Kop } from '../ui'
import { AuditsLijst } from './audits'
import { ProjectVenster } from './project-venster'
import { CareLijst } from './care'

/**
 * Levering van NextGenSolutions: elk gewonnen project per fase (Briefing tot
 * Care) en het Care-register. Een project start vanuit de deal (Closed Won).
 */
export function LeveringClient({ begin, openProject, tab: beginTab, verkoop = true }: { begin: LeveringData; openProject: string | null; tab: 'projecten' | 'care' | 'audits'; verkoop?: boolean }) {
  const router = useRouter()
  const [data, setData] = useState(begin)
  const [tab, setTab] = useState(beginTab)
  const [open, setOpen] = useState<string | null>(openProject)
  const vernieuw = useCallback(async () => {
    const r = await fetch('/api/admin/nextgensolutions/levering', { cache: 'no-store' })
    if (r.ok) setData(await r.json())
  }, [])
  const kies = (id: string | null) => {
    setOpen(id)
    const q = new URLSearchParams(window.location.search)
    if (id) q.set('project', id); else q.delete('project')
    router.replace(`/admin/nextgensolutions/levering${q.toString() ? `?${q}` : ''}`, { scroll: false })
  }
  const perFase = (f: ProjectFase) => data.projecten.filter((p) => p.fase === f)
  const teLaatCare = data.care.filter((c) => c.teLaat).length

  return (
    <div className="space-y-5 animate-fade-in">
      <Kop actief="levering" titel="Levering" sub="Van briefing tot Care, per gewonnen project." tabs={verkoop ? undefined : ['levering']} />
      {!data.klaar && <div className="card-base text-sm text-gray-600">De levering is er pas na de update van de databank.</div>}
      <div className="inline-flex rounded-full p-1 bg-gray-100" role="tablist">
        {([['projecten', `Projecten (${data.projecten.length})`], ['audits', 'Audits'], ['care', `Care (${data.care.length})${teLaatCare ? ` · ${teLaatCare} te laat` : ''}`]] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`text-sm px-3.5 py-1.5 rounded-full ${tab === k ? 'bg-white shadow-sm font-semibold text-gray-900' : 'text-gray-600'}`}>{l}</button>
        ))}
      </div>

      {tab === 'audits' && <AuditsLijst />}
      {tab === 'projecten' && (
        data.projecten.length === 0 ? (
          <div className="card-base text-sm text-gray-500 text-center py-10">Nog geen projecten. Open een deal in Closed Won en kies <b>Leveringsproject starten</b>.</div>
        ) : (
          <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1 snap-x">
            {PROJECT_FASES.map((f) => {
              const lijst = perFase(f.key)
              return (
                <section key={f.key} className="snap-start shrink-0 w-[78vw] sm:w-64 space-y-2">
                  <h2 className="text-xs font-semibold text-gray-600 flex items-center justify-between px-1"><span>{f.label}</span><span className="text-gray-400">{lijst.length}</span></h2>
                  {lijst.map((p) => (
                    <button key={p.id} type="button" onClick={() => kies(p.id)} className="card-base !p-3 w-full text-left space-y-1 hover:shadow-md transition-shadow">
                      <div className="text-sm font-semibold truncate">{p.titel}</div>
                      <div className="text-[11px] text-gray-500 truncate">{p.klant ?? 'geen klant gekoppeld'}{p.verantwoordelijke ? ` · ${p.verantwoordelijke}` : ''}</div>
                      {p.stories.totaal > 0 && <div className="text-[11px] text-gray-600">{p.stories.klaar}/{p.stories.totaal - p.stories.voorstel} stories klaar · {p.stories.besteed}/{p.stories.geschat} u{p.stories.voorstel ? ` · ${p.stories.voorstel} voorstel` : ''}</div>}
                      {p.planTeLaat && <div className="text-[11px] text-amber-800 flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{p.planTeLaat} dagen na de audit geen plan</div>}
                      {f.key === 'briefing' && !p.briefing_bevestigd_op && <div className="text-[11px] text-gray-500">Briefing nog te bevestigen</div>}
                    </button>
                  ))}
                  {!lijst.length && <div className="rounded-xl border border-dashed border-gray-200 h-16" />}
                </section>
              )
            })}
          </div>
        )
      )}

      {tab === 'care' && (
        <div className="card-base">
          <CareLijst items={data.care} onVernieuw={vernieuw} />
        </div>
      )}

      {open && <ProjectVenster id={open} onSluit={() => kies(null)} onVernieuw={vernieuw} />}
    </div>
  )
}
