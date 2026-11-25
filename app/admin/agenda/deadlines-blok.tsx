'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Clock, Flag, Loader2 } from 'lucide-react'
import { deadlineLabel } from '@/lib/agenda/model'
import type { MijnDeadline } from '@/lib/agenda/deadlines-server'
import { actie, api, focusRing } from './gedeeld'

/**
 * Command Center: jouw deadlines van vandaag (en wat de voorbije week niet af
 * raakte), het uur groot vooraan. Afvinken kan hier meteen. Niets = geen blok.
 */
export function DeadlinesBlok({ begin, magAanpassen }: { begin: MijnDeadline[]; magAanpassen: boolean }) {
  const [lijst, setLijst] = useState(begin)
  const [bezig, setBezig] = useState<string | null>(null)
  // Na een ingesproken taak of een wijziging elders: opnieuw ophalen.
  useEffect(() => {
    const her = () => { api<{ deadlines: MijnDeadline[] }>('/api/admin/agenda?deadlines=1').then((j) => setLijst(j.deadlines)).catch(() => null) }
    window.addEventListener('agenda:gewijzigd', her)
    return () => window.removeEventListener('agenda:gewijzigd', her)
  }, [])
  if (!lijst.length) return null
  const teLaat = lijst.filter((d) => d.teLaat).length

  const klaar = async (d: MijnDeadline) => {
    setBezig(d.id)
    try {
      await actie({ actie: 'item.wijzig', id: d.id, status: 'klaar' })
      setLijst((x) => x.filter((y) => y.id !== d.id))
      toast.success(`Completed: ${d.titel}`, {
        action: { label: 'Ongedaan maken', onClick: () => { actie({ actie: 'item.wijzig', id: d.id, status: 'open' }).then(() => setLijst((x) => [...x, d].sort((a, b) => a.deadline_op.localeCompare(b.deadline_op)))).catch(() => toast.error('Terugzetten mislukt')) } },
      })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Afvinken mislukt') } finally { setBezig(null) }
  }

  return (
    <section className="card-base">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="h-4 w-4" />
        <h2 className="font-semibold text-gray-900">Deadlines</h2>
        <span className="text-xs text-gray-500">{lijst.length - teLaat} vandaag{teLaat ? <span className="text-red-600 font-semibold"> · {teLaat} voorbij</span> : null}</span>
      </div>
      <ul className="divide-y divide-gray-100">
        {lijst.map((d) => {
          const l = deadlineLabel(d.deadline_op)
          const uurTekst = l.tekst.replace(/^Deadline /, '')
          return (
            <li key={d.id} className="flex items-center gap-3 py-2.5">
              <span className={`shrink-0 min-w-[64px] h-8 px-2 rounded-lg inline-flex items-center justify-center gap-1 text-sm font-bold tabular-nums ${l.teLaat ? 'bg-red-600 text-white' : 'bg-gray-900 text-white'}`} title={l.tekst}>
                <Clock className="h-3.5 w-3.5" />{uurTekst}
              </span>
              <a href={`/admin/agenda?item=${d.id}`} className={`min-w-0 flex-1 rounded ${focusRing}`}>
                <div className="text-sm font-semibold text-gray-900 truncate flex items-center gap-1.5">
                  {d.urgent && <Flag className="h-3.5 w-3.5 shrink-0 text-red-600 fill-red-600" />}{d.titel}
                </div>
                <div className="text-xs text-gray-500 truncate">
                  {[l.teLaat ? (l.vandaag ? 'Voorbij' : 'Te laat') : null, d.pad, d.samenMet.length ? `samen met ${d.samenMet.join(', ')}` : null].filter(Boolean).join(' · ')}
                </div>
              </a>
              {magAanpassen && (
                <button type="button" onClick={() => klaar(d)} disabled={bezig === d.id} className={`shrink-0 inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-semibold hover:border-gray-400 ${focusRing}`}>
                  {bezig === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Complete
                </button>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
