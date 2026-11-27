'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/app/admin/materiaal/dialogen'
import { vandaag, plusDagen, maandagVan, zoneNaarIso, kortDag, plaatsVan, type Item } from '@/lib/agenda/model'
import { naarDag, vanVorigeDagen, laatsteDag, hoeLangOpen, DAGEN_TERUG, type NaarDag } from '@/lib/agenda/dag-afsluiten'
import { geplandMinuten, urenTekst } from '@/lib/agenda/team'
import { actie, api, MapLabel, focusRing, type BoomData } from './gedeeld'

type Rij = { i: Item; soort: 'zonder' | 'blijven' | 'week' }

/**
 * Week plannen (verbeterplan fase 3, naast Dag afsluiten): je open taken zonder dag, wat
 * blijven liggen is en wat al in de week staat, met per taak één klik op de dag. Bovenaan
 * hoeveel er al per dag gepland staat. Enkel je eigen taken; niets gebeurt vanzelf.
 */
export function WeekPlannen({ boom, onSluit, onVernieuw }: { boom: BoomData; onSluit: () => void; onVernieuw: () => void }) {
  const v = vandaag()
  // In het weekend: standaard de volgende week.
  const [volgende, setVolgende] = useState(() => [6, 0].includes(new Date().getDay()))
  const maandag = plusDagen(maandagVan(v), volgende ? 7 : 0)
  const dagen = useMemo(() => Array.from({ length: 5 }, (_, n) => plusDagen(maandag, n)), [maandag])
  const [weekItems, setWeekItems] = useState<Item[] | null>(null)
  const [rijen, setRijen] = useState<Rij[] | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)

  const laad = useCallback(async () => {
    setRijen(null)
    try {
      const [bereik, alles] = await Promise.all([
        api<{ items: Item[] }>(`/api/admin/agenda?van=${encodeURIComponent(zoneNaarIso(plusDagen(v, -DAGEN_TERUG - 1), '00:00'))}&tot=${encodeURIComponent(zoneNaarIso(plusDagen(maandag, 7), '00:00'))}`),
        api<{ items: Item[] }>('/api/admin/agenda?container=alles'),
      ])
      const mijn = (i: Item) => i.bron === 'ag' && i.toegewezen.includes(boom.ik) && i.status !== 'klaar'
      const inWeek = bereik.items.filter((i) => { const d = laatsteDag(i); return !!d && d >= maandag && d <= plusDagen(maandag, 6) })
      setWeekItems(inWeek)
      const zonder = alles.items.filter((i) => mijn(i) && !i.start_op && !i.eind_op && !i.deadline_op).slice(0, 60)
      const blijven = vanVorigeDagen(bereik.items, { ik: boom.ik, dag: v }).filter((i) => !volgende || laatsteDag(i)! < maandag)
      const week = inWeek.filter((i) => mijn(i) && plaatsVan(i)?.soort !== 'rooster')
      const gezien = new Set<string>()
      const uit: Rij[] = []
      for (const [soort, l] of [['blijven', blijven], ['zonder', zonder], ['week', week]] as const) for (const i of l) if (!gezien.has(i.id)) { gezien.add(i.id); uit.push({ i, soort }) }
      setRijen(uit)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setRijen([]) }
  }, [boom.ik, maandag, v, volgende])
  useEffect(() => { void laad() }, [laad])

  const perDag = useMemo(() => dagen.map((d) => geplandMinuten(weekItems ?? [], boom.ik, [d])), [dagen, weekItems, boom.ik])
  const telPerDag = useMemo(() => dagen.map((d) => (weekItems ?? []).filter((i) => i.toegewezen.includes(boom.ik) && i.status !== 'klaar' && laatsteDag(i) === d).length), [dagen, weekItems, boom.ik])

  const zet = async (r: Rij, d: string) => {
    const nieuw: NaarDag | null = r.soort === 'zonder' ? { start_op: null, eind_op: zoneNaarIso(d, '00:00'), heel_dag: true, deadline_op: null } : naarDag(r.i, d)
    if (!nieuw) return
    const terug = { id: r.i.id, start_op: r.i.start_op, eind_op: r.i.eind_op, heel_dag: r.i.heel_dag, deadline_op: r.i.deadline_op }
    setBezig(r.i.id)
    try {
      await actie({ actie: 'item.verplaats', wijzigingen: [{ id: r.i.id, ...nieuw }] })
      const bijgewerkt = { ...r.i, ...nieuw }
      setRijen((l) => l?.map((x) => (x.i.id === r.i.id ? { i: bijgewerkt, soort: 'week' } : x)) ?? null)
      setWeekItems((l) => [...(l ?? []).filter((x) => x.id !== r.i.id), bijgewerkt])
      onVernieuw()
      toast.success(`${r.i.titel} → ${kortDag(d)}`, { action: { label: 'Ongedaan maken', onClick: () => { actie({ actie: 'item.verplaats', wijzigingen: [terug] }).then(() => { onVernieuw(); void laad() }).catch(() => toast.error('Terugzetten mislukt')) } } })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verplaatsen mislukt') } finally { setBezig(null) }
  }

  const KOP: Record<Rij['soort'], string> = { blijven: 'Blijven liggen', zonder: 'Nog geen dag', week: 'Al in deze week' }
  return (
    <Modal titel="Week plannen" sub={`Week van ${kortDag(maandag)}`} onSluit={onSluit} breed>
      <div className="space-y-4">
        <div className="flex gap-1.5">
          <button type="button" onClick={() => setVolgende(false)} aria-pressed={!volgende} className={`rounded-full border px-3 py-1 text-xs ${!volgende ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200'} ${focusRing}`}>Deze week</button>
          <button type="button" onClick={() => setVolgende(true)} aria-pressed={volgende} className={`rounded-full border px-3 py-1 text-xs ${volgende ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200'} ${focusRing}`}>Volgende week</button>
        </div>
        <div className="grid grid-cols-5 gap-1.5">
          {dagen.map((d, n) => (
            <div key={d} className={`rounded-xl border px-2 py-1.5 ${d === v ? 'border-gray-900' : 'border-gray-100'} ${d < v ? 'opacity-50' : ''}`}>
              <div className="text-xs font-semibold capitalize">{kortDag(d)}</div>
              <div className="text-[11px] text-gray-500 tabular-nums">{urenTekst(perDag[n])} op uur · {telPerDag[n]} {telPerDag[n] === 1 ? 'taak' : 'taken'}</div>
            </div>
          ))}
        </div>
        {!rijen ? <div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
          : !rijen.length ? <div className="py-6 text-center text-sm text-gray-500">Niets meer te plannen. Mooi.</div> : (
            (['blijven', 'zonder', 'week'] as const).map((soort) => {
              const l = rijen.filter((r) => r.soort === soort)
              if (!l.length) return null
              return (
                <div key={soort}>
                  <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">{KOP[soort]} · {l.length}</div>
                  <ul className="divide-y divide-gray-100 rounded-xl border border-gray-100">
                    {l.map((r) => {
                      const nu = laatsteDag(r.i)
                      return (
                        <li key={r.i.id} className="px-3 py-2 flex flex-wrap items-center gap-2">
                          <div className="min-w-0 flex-1 basis-56">
                            <div className="text-sm font-medium truncate">{r.i.titel}</div>
                            <div className="text-[11px] text-gray-500 flex items-center gap-2 min-w-0"><span className="truncate"><MapLabel boom={boom} lijstId={r.i.lijst_id} leeg="Zonder map" /></span>{soort === 'blijven' && nu && <span className="shrink-0">{hoeLangOpen(nu)}</span>}</div>
                          </div>
                          <div className="flex gap-1 shrink-0">
                            {dagen.map((d) => (
                              <button key={d} type="button" disabled={bezig === r.i.id || d < v} onClick={() => zet(r, d)} aria-pressed={nu === d}
                                className={`h-7 min-w-[2.25rem] rounded-lg border px-1.5 text-[11px] font-semibold capitalize disabled:opacity-40 ${nu === d ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 hover:border-gray-400'} ${focusRing}`}>
                                {kortDag(d).slice(0, 2)}
                              </button>
                            ))}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })
          )}
      </div>
    </Modal>
  )
}
