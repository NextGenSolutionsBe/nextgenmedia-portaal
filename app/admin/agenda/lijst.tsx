'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, ChevronRight, Flag, FileText, Plus, Loader2, Video, ListTree, Lock } from 'lucide-react'
import { vandaag, plaatsVan, plusDagen, kortDag, type Item, type Persoon } from '@/lib/agenda/model'
import { actie, Avatars, focusRing, type BoomData } from './gedeeld'

/** Alle taken van een lijst, map of space, per lijst gegroepeerd, open eerst. */
export function LijstWeergave({ lijstIds, items, boom, personen, laden, magToevoegen, onOpen, onKlaar, onToegevoegd, onDoc }: {
  lijstIds: string[]; items: Item[] | null; boom: BoomData; personen: Map<string, Persoon>; laden: boolean
  magToevoegen: boolean
  onOpen: (i: Item) => void; onKlaar: (i: Item) => void; onToegevoegd: () => void; onDoc: (id: string) => void
}) {
  const labels = useMemo(() => new Map(boom.labels.map((l) => [l.id, l])), [boom.labels])
  const groepen = useMemo(() => {
    const per = new Map<string, Item[]>()
    for (const i of items ?? []) if (!i.parent_id && i.lijst_id) per.set(i.lijst_id, [...(per.get(i.lijst_id) ?? []), i])
    return lijstIds.map((id) => ({ lijst: boom.lijsten.find((l) => l.id === id)!, items: per.get(id) ?? [] })).filter((g) => g.lijst)
  }, [items, lijstIds, boom.lijsten])
  if (!items && laden) return <div className="card-base flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  const docs = boom.docs.filter((d) => d.lijst_id && lijstIds.includes(d.lijst_id))
  return (
    <div className="space-y-4">
      {docs.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {docs.map((d) => (
            <button key={d.id} type="button" onClick={() => onDoc(d.id)} className={`inline-flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm hover:border-gray-400 ${focusRing}`}>
              <FileText className="h-4 w-4 text-gray-500" />{d.titel}{d.prive && <Lock className="h-3 w-3 text-gray-400" />}
            </button>
          ))}
        </div>
      )}
      {groepen.map((g) => <Groep key={g.lijst.id} titel={groepen.length > 1 ? g.lijst.naam : null} lijstId={g.lijst.id} items={g.items} personen={personen} labels={labels} magToevoegen={magToevoegen} onOpen={onOpen} onKlaar={onKlaar} onToegevoegd={onToegevoegd} />)}
      {!groepen.length && <div className="card-base text-sm text-gray-500 py-10 text-center">Hier staan nog geen lijsten.</div>}
    </div>
  )
}

function Groep({ titel, lijstId, items, personen, labels, magToevoegen, onOpen, onKlaar, onToegevoegd }: {
  titel: string | null; lijstId: string; items: Item[]; personen: Map<string, Persoon>; labels: Map<string, BoomData['labels'][number]>
  magToevoegen: boolean; onOpen: (i: Item) => void; onKlaar: (i: Item) => void; onToegevoegd: () => void
}) {
  const [toonKlaar, setToonKlaar] = useState(false)
  const [dicht, setDicht] = useState(false)
  const [nieuw, setNieuw] = useState('')
  const [bezig, setBezig] = useState(false)
  const sleutel = (i: Item) => i.eind_op ?? i.start_op ?? '9999'
  const open = items.filter((i) => i.status !== 'klaar').sort((a, b) => Number(b.urgent) - Number(a.urgent) || sleutel(a).localeCompare(sleutel(b)) || a.titel.localeCompare(b.titel))
  const klaar = items.filter((i) => i.status === 'klaar').sort((a, b) => (b.afgerond_op ?? '').localeCompare(a.afgerond_op ?? ''))
  const voegToe = async () => {
    const t = nieuw.trim()
    if (!t) return
    setBezig(true)
    try { await actie({ actie: 'item.nieuw', titel: t, lijst_id: lijstId, heel_dag: true }); setNieuw(''); onToegevoegd() } catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setBezig(false) }
  }
  return (
    <section className="card-base !p-0 overflow-hidden">
      {titel && (
        <button type="button" onClick={() => setDicht(!dicht)} className={`w-full flex items-center gap-2 px-4 py-2.5 border-b border-gray-100 text-left ${focusRing}`}>
          <ChevronRight className={`h-4 w-4 transition-transform ${dicht ? '' : 'rotate-90'}`} /><ListTree className="h-4 w-4 text-gray-400" />
          <span className="font-semibold text-sm">{titel}</span><span className="text-xs text-gray-400">{open.length} open</span>
        </button>
      )}
      {!dicht && (
        <>
          <div className="hidden sm:grid grid-cols-[1fr_120px_130px] gap-3 px-4 py-1.5 border-b border-gray-100 table-th !bg-transparent">
            <span>Taak</span><span>Wie</span><span>Wanneer</span>
          </div>
          <ul className="divide-y divide-gray-100">
            {open.map((i) => <Rij key={i.id} i={i} personen={personen} labels={labels} onOpen={onOpen} onKlaar={onKlaar} />)}
            {!open.length && <li className="px-4 py-3 text-sm text-gray-400">Niets meer open.</li>}
            {magToevoegen && (
              <li className="flex items-center gap-2 px-4 py-1.5">
                <Plus className="h-4 w-4 text-gray-400" />
                <input value={nieuw} onChange={(e) => setNieuw(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') voegToe() }} disabled={bezig} placeholder="Taak toevoegen" aria-label="Taak toevoegen"
                  className="flex-1 bg-transparent text-sm border-0 p-1.5 focus:ring-0 focus:outline-none" />
                {bezig && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
              </li>
            )}
          </ul>
          {klaar.length > 0 && (
            <div className="border-t border-gray-100">
              <button type="button" onClick={() => setToonKlaar(!toonKlaar)} className={`w-full flex items-center gap-2 px-4 py-2 text-xs text-gray-500 hover:bg-gray-50 ${focusRing}`}>
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${toonKlaar ? 'rotate-90' : ''}`} />Completed ({klaar.length})
              </button>
              {toonKlaar && <ul className="divide-y divide-gray-100">{klaar.slice(0, 300).map((i) => <Rij key={i.id} i={i} personen={personen} labels={labels} onOpen={onOpen} onKlaar={onKlaar} />)}</ul>}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function Rij({ i, personen, labels, onOpen, onKlaar }: { i: Item; personen: Map<string, Persoon>; labels: Map<string, BoomData['labels'][number]>; onOpen: (i: Item) => void; onKlaar: (i: Item) => void }) {
  const klaar = i.status === 'klaar'
  const p = plaatsVan(i)
  const einddag = p ? (p.soort === 'rooster' ? p.dag : p.tot) : null
  const telaat = !klaar && i.soort !== 'meeting' && einddag !== null && einddag < vandaag()
  const vandaagD = !klaar && einddag === vandaag()
  return (
    <li className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_120px_130px] gap-3 items-center px-4 py-2 hover:bg-gray-50/70">
      <div className="flex items-center gap-2.5 min-w-0">
        {i.soort === 'meeting' ? <Video className="h-4 w-4 shrink-0 text-gray-400" /> : (
          <button type="button" onClick={() => onKlaar(i)} aria-label={klaar ? 'Terug open zetten' : 'Afvinken'}
            className={`h-4 w-4 shrink-0 rounded-full border flex items-center justify-center ${klaar ? 'bg-gray-900 border-gray-900 text-white' : 'border-gray-400 hover:border-gray-900'} ${focusRing}`}>{klaar && <Check className="h-2.5 w-2.5" />}</button>
        )}
        <button type="button" onClick={() => onOpen(i)} className={`min-w-0 flex items-center gap-2 text-left text-sm ${focusRing} rounded`}>
          {i.urgent && !klaar && <Flag className="h-3.5 w-3.5 shrink-0 text-red-600 fill-red-600" />}
          <span className={`truncate ${klaar ? 'line-through text-gray-400' : 'text-gray-900'}`}>{i.titel}</span>
          {!!i.subtaken && <span className="shrink-0 text-[11px] text-gray-400">{i.subtaken} sub</span>}
          {i.prive && <Lock className="h-3 w-3 shrink-0 text-gray-400" />}
          {i.labels.map((l) => labels.get(l)).filter(Boolean).slice(0, 3).map((l) => <span key={l!.id} className="hidden md:inline shrink-0 rounded-full px-1.5 py-px text-[10px] font-semibold" style={{ background: l!.kleur }}>{l!.naam}</span>)}
        </button>
      </div>
      <div className="hidden sm:block"><Avatars ids={i.toegewezen} personen={personen} max={4} maat={20} /></div>
      <div className={`text-xs tabular-nums ${telaat ? 'text-red-600 font-semibold' : vandaagD ? 'text-gray-900 font-semibold' : 'text-gray-500'}`}>
        {klaar && i.afgerond_op ? `✓ ${new Date(i.afgerond_op).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' })}` : wanneer(i)}
      </div>
    </li>
  )
}

const dagLabel = (d: string) => (d === vandaag() ? 'Vandaag' : d === plusDagen(vandaag(), 1) ? 'Morgen' : d === plusDagen(vandaag(), -1) ? 'Gisteren' : kortDag(d))
const hm = (n: number) => `${String(Math.floor(n / 60) % 24).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`

/** "Vandaag 14:00", "Morgen", "do 27 nov", "ma 1 dec – vr 5 dec" */
export function wanneer(i: Pick<Item, 'start_op' | 'eind_op' | 'heel_dag'>): string {
  const p = plaatsVan(i)
  if (!p) return '—'
  if (p.soort === 'rooster') return `${dagLabel(p.dag)} ${hm(p.vanMin)}`
  return p.van === p.tot ? dagLabel(p.tot) : `${kortDag(p.van)} – ${kortDag(p.tot)}`
}
