'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { X, Loader2, Save, MapPin, Home, Flag, Clock } from 'lucide-react'
import { Kalender, kalenderBereik, sessieSoort, beschikbaarheidSoort, type KalItem, type Weergave } from '@/components/personeel/kalender'
import { api, Chip, datumNl, kortUur, uurNl, dagVanIso, vandaagBE, INP, LBL, LinksLijst, type LinkItem } from '@/components/personeel/ui'
import { WERKSTATUS, type Werkstatus } from '@/lib/personeel/model'

type Blok = {
  id: string; datum: string; start_tijd: string; eind_tijd: string; project: string | null; taak: string | null; klant: string | null; opdracht: string | null
  briefing: string | null; deliverables: string | null; links: LinkItem[]; deadline: string | null; prioriteit: string | null; verwachte_duur_min: number | null
  locatie: string | null; thuiswerk: boolean; status: string; werkstatus: Werkstatus; voortgang: string | null
}
type Data = {
  planning: Blok[]
  beschikbaarheid: { id: string; datum: string; start_tijd: string; eind_tijd: string; status: string }[]
  sessies: { id: string; start_at: string; eind_at: string | null; status: string; taak: string | null; project: string | null }[]
}

/** De eigen kalender: werkblokken met briefing, eigen beschikbaarheden en eigen sessies. */
export function TeamPlanning() {
  const zoek = useSearchParams()
  const [weergave, setWeergave] = useState<Weergave>('week')
  const [anker, setAnker] = useState(vandaagBE())
  const [data, setData] = useState<Data | null>(null)
  const [open, setOpen] = useState<string | null>(zoek.get('blok'))

  const bereik = kalenderBereik(weergave, anker)
  const laad = useCallback(async () => {
    try { setData(await api<Data>(`/api/team/planning?van=${bereik.van}&tot=${bereik.tot}`)) } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [bereik.van, bereik.tot])
  useEffect(() => { laad() }, [laad])

  const items = useMemo<KalItem[]>(() => {
    if (!data) return []
    const uit: KalItem[] = []
    for (const p of data.planning) uit.push({ id: `p${p.id}`, datum: p.datum, start: kortUur(p.start_tijd), eind: kortUur(p.eind_tijd), titel: p.taak ?? p.project ?? 'Werkblok', sub: [p.klant, p.thuiswerk ? 'Thuiswerk' : p.locatie].filter(Boolean).join(' · '), soort: p.status === 'geannuleerd' ? 'planning_afgewezen' : 'planning', onClick: () => setOpen(p.id) })
    for (const b of data.beschikbaarheid) { const s = beschikbaarheidSoort(b.status); if (s) uit.push({ id: `b${b.id}`, datum: b.datum, start: kortUur(b.start_tijd), eind: kortUur(b.eind_tijd), titel: b.status === 'afgewezen' ? 'Niet ingepland' : 'Beschikbaar', soort: s }) }
    for (const s of data.sessies) uit.push({ id: `s${s.id}`, datum: dagVanIso(s.start_at), start: uurNl(s.start_at), eind: s.eind_at ? uurNl(s.eind_at) : '…', titel: s.taak ?? s.project ?? 'Werksessie', soort: sessieSoort(s.status) })
    return uit
  }, [data])

  const blok = data?.planning.find((p) => p.id === open) ?? null
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Mijn planning</h1>
      {!data ? <div className="py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
        : <Kalender items={items} weergave={weergave} anker={anker} onWeergave={setWeergave} onAnker={setAnker} />}
      {blok && <BlokDetail blok={blok} onSluit={() => setOpen(null)} onOpgeslagen={laad} />}
    </div>
  )
}

function BlokDetail({ blok, onSluit, onOpgeslagen }: { blok: Blok; onSluit: () => void; onOpgeslagen: () => void }) {
  const [werkstatus, setWerkstatus] = useState<Werkstatus>(blok.werkstatus)
  const [voortgang, setVoortgang] = useState(blok.voortgang ?? '')
  const [bezig, setBezig] = useState(false)
  const bewaar = async () => {
    setBezig(true)
    try { await api(`/api/team/planning/${blok.id}`, { method: 'PATCH', body: { werkstatus, voortgang } }); toast.success('Voortgang bewaard.'); onOpgeslagen() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center" onClick={onSluit}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-4 py-3 flex items-start justify-between gap-2">
          <div>
            <div className="font-semibold">{blok.taak ?? blok.project ?? 'Werkblok'}</div>
            <div className="text-xs text-gray-500">{datumNl(blok.datum)} · {kortUur(blok.start_tijd)}–{kortUur(blok.eind_tijd)}{blok.status === 'geannuleerd' ? ' · geannuleerd' : ''}</div>
          </div>
          <button type="button" onClick={onSluit} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-4 space-y-3 text-sm">
          <div className="flex flex-wrap gap-2 text-xs text-gray-600">
            {blok.klant && <Chip cls="bg-gray-100 text-gray-700 border-gray-200">{blok.klant}</Chip>}
            {blok.project && <Chip cls="bg-gray-100 text-gray-700 border-gray-200">{blok.project}</Chip>}
            {blok.opdracht && <Chip cls="bg-gray-100 text-gray-700 border-gray-200">{blok.opdracht}</Chip>}
            {blok.thuiswerk ? <span className="inline-flex items-center gap-1"><Home className="h-3.5 w-3.5" />Thuiswerk</span> : blok.locatie && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{blok.locatie}</span>}
            {blok.deadline && <span className="inline-flex items-center gap-1"><Flag className="h-3.5 w-3.5" />Deadline {datumNl(blok.deadline)}</span>}
            {blok.verwachte_duur_min && <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" />± {Math.round(blok.verwachte_duur_min / 6) / 10} u</span>}
            {blok.prioriteit && blok.prioriteit !== 'normaal' && <Chip cls={blok.prioriteit === 'dringend' || blok.prioriteit === 'hoog' ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-600 border-gray-200'}>Prioriteit: {blok.prioriteit}</Chip>}
          </div>
          <div><div className={LBL}>Briefing</div><div className="whitespace-pre-wrap text-gray-800 bg-gray-50 rounded-lg p-3">{blok.briefing || 'Geen briefing.'}</div></div>
          {blok.deliverables && <div><div className={LBL}>Deliverables</div><div className="whitespace-pre-wrap text-gray-800">{blok.deliverables}</div></div>}
          {blok.links?.length > 0 && <div><div className={LBL}>Links en bestanden</div><LinksLijst links={blok.links} bestandUrl={(p) => `/api/team/bestand?pad=${encodeURIComponent(p)}`} /></div>}
          {blok.status !== 'geannuleerd' && (
            <div className="border-t border-gray-100 pt-3 space-y-2">
              <div><label className={LBL}>Status</label>
                <select className={INP} value={werkstatus} onChange={(e) => setWerkstatus(e.target.value as Werkstatus)}>
                  {(Object.keys(WERKSTATUS) as Werkstatus[]).map((w) => <option key={w} value={w}>{WERKSTATUS[w].label}</option>)}
                </select>
              </div>
              <div><label className={LBL}>Voortgangsverslag</label><textarea rows={4} className={INP} value={voortgang} onChange={(e) => setVoortgang(e.target.value)} placeholder="Wat is klaar, wat nog niet, vragen…" /></div>
              <button type="button" disabled={bezig} onClick={bewaar} className="btn-primary w-full justify-center">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Voortgang bewaren</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
