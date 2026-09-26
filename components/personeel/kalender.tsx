'use client'

import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays, CalendarRange, List, Sun } from 'lucide-react'
import { KALENDER_KLEUR, type KalenderSoort } from '@/lib/personeel/model'
import { dagLang, datumNl, vandaagBE } from './ui'

/**
 * Eén kalender voor admins en medewerkers: dag, week, maand en lijst.
 * De kleuren komen uit KALENDER_KLEUR, dus overal dezelfde betekenis.
 */

export type KalItem = { id: string; datum: string; start?: string | null; eind?: string | null; titel: string; sub?: string | null; soort: KalenderSoort; onClick?: () => void }
export type Weergave = 'dag' | 'week' | 'maand' | 'lijst'

const plus = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const wd = (d: string) => (new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7
const DAGEN = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']
const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

/** Het datumbereik dat een weergave toont (om data voor op te halen). */
export function kalenderBereik(w: Weergave, anker: string): { van: string; tot: string } {
  if (w === 'dag') return { van: anker, tot: anker }
  if (w === 'week') { const v = plus(anker, -wd(anker)); return { van: v, tot: plus(v, 6) } }
  if (w === 'lijst') return { van: plus(anker, -7), tot: plus(anker, 42) }
  const eerste = `${anker.slice(0, 7)}-01`
  const v = plus(eerste, -wd(eerste))
  return { van: v, tot: plus(v, 41) }
}

export function Kalender({ items, weergave, anker, onWeergave, onAnker, onDag, legenda = true }: {
  items: KalItem[]; weergave: Weergave; anker: string
  onWeergave: (w: Weergave) => void; onAnker: (d: string) => void; onDag?: (d: string) => void; legenda?: boolean
}) {
  const vandaag = vandaagBE()
  const perDag = useMemo(() => {
    const m = new Map<string, KalItem[]>()
    for (const it of items) { const l = m.get(it.datum) ?? []; l.push(it); m.set(it.datum, l) }
    for (const l of m.values()) l.sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))
    return m
  }, [items])
  const ga = (r: -1 | 1) => {
    if (weergave === 'dag') onAnker(plus(anker, r))
    else if (weergave === 'week' || weergave === 'lijst') onAnker(plus(anker, 7 * r))
    else { const [j, m] = anker.split('-').map(Number); const d = new Date(Date.UTC(j, m - 1 + r, 1)); onAnker(d.toISOString().slice(0, 10)) }
  }
  const b = kalenderBereik(weergave, anker)
  const titel = weergave === 'maand' ? `${MAANDEN[Number(anker.slice(5, 7)) - 1]} ${anker.slice(0, 4)}` : weergave === 'dag' ? dagLang(anker) : `${datumNl(b.van)} – ${datumNl(b.tot)}`

  const Blok = ({ it, compact }: { it: KalItem; compact?: boolean }) => (
    <button type="button" onClick={it.onClick} disabled={!it.onClick}
      className={`w-full text-left rounded-md border px-1.5 ${compact ? 'py-0.5 text-[10.5px] truncate' : 'py-1.5 text-xs'} ${KALENDER_KLEUR[it.soort].blok} ${it.onClick ? 'hover:brightness-95' : 'cursor-default'}`}
      title={`${it.start ? `${it.start}–${it.eind ?? ''} ` : ''}${it.titel}${it.sub ? ` · ${it.sub}` : ''} (${KALENDER_KLEUR[it.soort].label})`}>
      {it.start && <span className="font-semibold tabular-nums">{it.start}{!compact && it.eind ? `–${it.eind}` : ''} </span>}
      <span className={compact ? '' : 'font-medium'}>{it.titel}</span>
      {!compact && it.sub && <span className="block text-[11px] opacity-80 truncate">{it.sub}</span>}
    </button>
  )

  return (
    <div className="card-base p-0 overflow-hidden">
      <div className="flex items-center justify-between gap-2 flex-wrap px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => ga(-1)} className="rounded-lg border border-gray-200 p-1.5 hover:bg-gray-50" aria-label="Vorige"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => onAnker(vandaag)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">Vandaag</button>
          <button type="button" onClick={() => ga(1)} className="rounded-lg border border-gray-200 p-1.5 hover:bg-gray-50" aria-label="Volgende"><ChevronRight className="h-4 w-4" /></button>
          <span className="text-sm font-semibold capitalize ml-1">{titel}</span>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
          {([['dag', Sun, 'Dag'], ['week', CalendarRange, 'Week'], ['maand', CalendarDays, 'Maand'], ['lijst', List, 'Lijst']] as const).map(([w, Icon, label]) => (
            <button key={w} type="button" onClick={() => onWeergave(w)} className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium ${weergave === w ? 'bg-black text-white' : 'text-gray-600 hover:bg-white'}`}><Icon className="h-3.5 w-3.5" /><span className="hidden sm:inline">{label}</span></button>
          ))}
        </div>
      </div>

      {weergave === 'maand' && (
        <>
          <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50 text-[10px] font-medium text-gray-500 uppercase">{DAGEN.map((d) => <div key={d} className="px-1 py-1 text-center">{d}</div>)}</div>
          <div className="grid grid-cols-7">
            {Array.from({ length: 42 }, (_, i) => plus(b.van, i)).map((d) => {
              const l = perDag.get(d) ?? []
              const inMaand = d.slice(0, 7) === anker.slice(0, 7)
              return (
                <div key={d} className={`min-h-[64px] sm:min-h-[100px] border-b border-r border-gray-100 p-1 flex flex-col gap-0.5 ${inMaand ? 'bg-white' : 'bg-gray-50/60'} ${d === vandaag ? 'ring-2 ring-inset ring-[#fff848]' : ''}`}>
                  <button type="button" onClick={() => (onDag ? onDag(d) : (onAnker(d), onWeergave('dag')))} className={`text-[11px] font-medium text-left ${inMaand ? 'text-gray-800' : 'text-gray-400'}`}>{Number(d.slice(8, 10))}</button>
                  <div className="hidden sm:flex flex-col gap-0.5">{l.slice(0, 3).map((it) => <Blok key={it.id} it={it} compact />)}{l.length > 3 && <button type="button" onClick={() => { onAnker(d); onWeergave('dag') }} className="text-[10px] text-gray-500 text-left">+{l.length - 3} meer</button>}</div>
                  {l.length > 0 && <button type="button" onClick={() => { onAnker(d); onWeergave('dag') }} className="sm:hidden flex gap-0.5 flex-wrap mt-auto">{l.slice(0, 6).map((it) => <span key={it.id} className={`h-1.5 w-1.5 rounded-full ${KALENDER_KLEUR[it.soort].stip}`} />)}</button>}
                </div>
              )
            })}
          </div>
        </>
      )}

      {weergave === 'week' && (
        <div className="grid grid-cols-1 sm:grid-cols-7 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
          {Array.from({ length: 7 }, (_, i) => plus(b.van, i)).map((d, i) => (
            <div key={d} className={`p-2 min-h-[80px] sm:min-h-[240px] ${d === vandaag ? 'bg-[#fff848]/10' : ''}`}>
              <button type="button" onClick={() => (onDag ? onDag(d) : (onAnker(d), onWeergave('dag')))} className="text-xs font-semibold text-gray-700 mb-1.5">{DAGEN[i]} {Number(d.slice(8, 10))}</button>
              <div className="space-y-1">{(perDag.get(d) ?? []).map((it) => <Blok key={it.id} it={it} />)}{!(perDag.get(d) ?? []).length && <div className="text-[11px] text-gray-300">—</div>}</div>
            </div>
          ))}
        </div>
      )}

      {weergave === 'dag' && (
        <div className="p-3 space-y-1.5">
          {(perDag.get(anker) ?? []).map((it) => <Blok key={it.id} it={it} />)}
          {!(perDag.get(anker) ?? []).length && <div className="text-sm text-gray-400 py-6 text-center">Niets gepland op deze dag.</div>}
          {onDag && <button type="button" onClick={() => onDag(anker)} className="btn-secondary text-xs mt-2">Deze dag openen</button>}
        </div>
      )}

      {weergave === 'lijst' && (
        <div className="divide-y divide-gray-100">
          {Array.from({ length: 50 }, (_, i) => plus(b.van, i)).filter((d) => (perDag.get(d) ?? []).length).map((d) => (
            <div key={d} className="px-3 py-2">
              <div className={`text-xs font-semibold capitalize mb-1 ${d === vandaag ? 'text-black' : 'text-gray-600'}`}>{dagLang(d)}{d === vandaag ? ' · vandaag' : ''}</div>
              <div className="space-y-1">{(perDag.get(d) ?? []).map((it) => <Blok key={it.id} it={it} />)}</div>
            </div>
          ))}
          {!items.length && <div className="text-sm text-gray-400 py-8 text-center">Niets in deze periode.</div>}
        </div>
      )}

      {legenda && (
        <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 border-t border-gray-100 text-[10.5px] text-gray-500">
          {(Object.keys(KALENDER_KLEUR) as KalenderSoort[]).map((k) => <span key={k} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${KALENDER_KLEUR[k].stip}`} />{KALENDER_KLEUR[k].label}</span>)}
        </div>
      )}
    </div>
  )
}

/** Een sessie (met echte tijdstippen) als kalenderblok. */
export function sessieSoort(status: string): KalenderSoort {
  if (status === 'actief') return 'sessie_actief'
  if (status === 'goedgekeurd') return 'uren_goedgekeurd'
  if (status === 'afgekeurd') return 'planning_afgewezen'
  return 'uren_ingediend'
}
export function beschikbaarheidSoort(status: string): KalenderSoort | null {
  if (status === 'ingediend') return 'beschikbaar_ingediend'
  if (status === 'afgewezen') return 'planning_afgewezen'
  return null // goedgekeurd/gedeeltelijk: het werkblok staat er al
}
