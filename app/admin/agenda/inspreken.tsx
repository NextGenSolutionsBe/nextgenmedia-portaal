'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Mic, Sparkles, Flag, CalendarPlus, Clock, AlertTriangle, MoonStar } from 'lucide-react'
import { Modal } from '@/app/admin/materiaal/dialogen'
import { DicteerKnop } from '@/components/admin/dicteer-knop'
import { zoneNaarIso, plusDagen, snelleDeadlines, vandaag, dag, uur } from '@/lib/agenda/model'
import type { InspreekVoorstel } from '@/lib/agenda/inspreken'
import { actie, api, MapKiezer, MapLabel, WieKiezer, LabelKeuze, labelVoorstel, focusRing, type BoomData } from './gedeeld'

/**
 * Een taak of afspraak inspreken (of typen). De AI vult het formulier in; jij
 * kijkt na en klikt op Toevoegen. Er wordt niets bewaard zonder die klik.
 */
export function InspreekVenster({ boom, onSluit, onToegevoegd }: { boom: BoomData; onSluit: () => void; onToegevoegd: (id: string) => void }) {
  const [zin, setZin] = useState('')
  const [bezig, setBezig] = useState(false)
  const [lezen, setLezen] = useState(false)
  const [v, setV] = useState<InspreekVoorstel | null>(null)
  const vorigBezig = useRef(false)

  const lees = useCallback(async (tekst: string) => {
    if (tekst.trim().length < 3) return
    setLezen(true)
    try {
      const r = await actie<{ voorstel: InspreekVoorstel }>({ actie: 'inspreek.lees', tekst })
      setV({ ...r.voorstel, toegewezen: r.voorstel.toegewezen.length ? r.voorstel.toegewezen : [boom.ik] })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Lezen mislukt') } finally { setLezen(false) }
  }, [boom.ik])

  // Zodra je stopt met inspreken (en de tekst netjes staat), meteen lezen.
  const zinRef = useRef(zin)
  zinRef.current = zin
  useEffect(() => {
    if (vorigBezig.current && !bezig && !v) void lees(zinRef.current)
    vorigBezig.current = bezig
  }, [bezig, v, lees])

  if (v) return <Formulier boom={boom} begin={v} zin={zin} onTerug={() => setV(null)} onSluit={onSluit} onToegevoegd={onToegevoegd} />

  return (
    <Modal titel="Taak inspreken" sub="Zeg wat er moet gebeuren, voor wanneer en wie het doet." onSluit={onSluit} breed
      voet={<><button type="button" onClick={onSluit} className="btn-secondary">Annuleren</button>
        <button type="button" disabled={zin.trim().length < 3 || lezen || bezig} onClick={() => lees(zin)} className="btn-primary">{lezen ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Maak er een taak van</button></>}>
      <div className="rounded-2xl border border-gray-200 bg-gray-50/60 p-4 flex items-center gap-3">
        <DicteerKnop zet={setZin} onBezig={setBezig} context="Taak voor de agenda" />
        <p className="text-sm text-gray-600">
          {bezig ? 'Spreek gerust door. Klik op het vierkantje als je klaar bent.' : 'Klik op de microfoon en spreek, bijvoorbeeld:'}
        </p>
      </div>
      {!zin && !bezig && (
        <p className="text-sm text-gray-500 italic leading-relaxed">
          &ldquo;Titel: samenvatting sturen naar Marijn. Beschrijving: de punten van de meeting van dinsdag. Moet vrijdag om vijf uur af zijn. Bram en Marco erop.&rdquo;
        </p>
      )}
      <textarea value={zin} onChange={(e) => setZin(e.target.value)} rows={5} className="input-base text-sm leading-relaxed" placeholder="Of typ het hier." aria-label="Wat moet er gebeuren" />
      {lezen && <p className="text-sm text-gray-600 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Formulier invullen…</p>}
    </Modal>
  )
}

const hm = (u: string | null) => u ?? ''

function Formulier({ boom, begin, zin, onTerug, onSluit, onToegevoegd }: {
  boom: BoomData; begin: InspreekVoorstel; zin: string; onTerug: () => void; onSluit: () => void; onToegevoegd: (id: string) => void
}) {
  const [f, setF] = useState(begin)
  const [mapOpen, setMapOpen] = useState(!begin.lijst_id)
  const [mapNodig, setMapNodig] = useState(false)
  const [bezig, setBezig] = useState(false)
  const zet = <K extends keyof InspreekVoorstel>(k: K, w: InspreekVoorstel[K]) => setF((x) => ({ ...x, [k]: w }))
  const voorstel = useMemo(() => labelVoorstel(boom, { titel: f.titel, lijst_id: f.lijst_id, soort: f.dag && f.van ? f.soort : 'taak' }), [boom, f.titel, f.lijst_id, f.dag, f.van, f.soort])
  const [labels, setLabels] = useState<string[]>([])
  const [labelsGekozen, setLabelsGekozen] = useState(false)
  useEffect(() => { if (!labelsGekozen) setLabels(voorstel ? [voorstel.id] : []) }, [voorstel, labelsGekozen])
  const deadlineIso = f.deadline_dag && f.deadline_uur ? zoneNaarIso(f.deadline_dag, f.deadline_uur) : null

  const voegToe = async () => {
    if (!f.titel.trim()) { toast.error('Geef een titel.'); return }
    if (!f.lijst_id) { setMapNodig(true); setMapOpen(true); return }
    setBezig(true)
    try {
      let start: string | null = null, eind: string | null = null, heelDag = false
      if (f.dag && f.van) {
        start = zoneNaarIso(f.dag, f.van)
        eind = f.tot ? zoneNaarIso(f.dag, f.tot) : new Date(Date.parse(start) + (f.soort === 'meeting' ? 3600_000 : 1800_000)).toISOString()
      } else if (f.dag) { heelDag = true; eind = zoneNaarIso(f.dag, '00:00') }
      const r = await actie({
        actie: 'item.nieuw', titel: f.titel.trim(), beschrijving: f.beschrijving ?? '', soort: f.dag && f.van ? f.soort : 'taak',
        start_op: start, eind_op: eind, heel_dag: heelDag, deadline_op: deadlineIso, lijst_id: f.lijst_id, toegewezen: f.toegewezen, urgent: f.urgent, labels,
      })
      toast.success(f.soort === 'meeting' && f.van ? 'Afspraak in de agenda gezet.' : 'Taak toegevoegd.')
      if (r.id) onToegevoegd(r.id)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setBezig(false) }
  }

  const chip = (aan: boolean) => `rounded-full border px-2.5 py-1 text-xs ${aan ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:border-gray-400'} ${focusRing}`
  return (
    <Modal titel="Klopt dit?" sub="Pas aan wat niet juist is en klik op Toevoegen." onSluit={onSluit} breed
      voet={<><button type="button" onClick={onTerug} className="btn-secondary">Opnieuw inspreken</button>
        <button type="button" disabled={bezig || !f.titel.trim()} onClick={voegToe} className="btn-primary">{bezig && <Loader2 className="h-4 w-4 animate-spin" />}Toevoegen</button></>}>
      {zin && <p className="text-xs text-gray-500 rounded-lg bg-gray-50 px-3 py-2 line-clamp-3" title={zin}><Mic className="inline h-3 w-3 mr-1" />{zin}</p>}
      {(f.opmerking || f.nietGevonden.length > 0) && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>{[f.opmerking, f.nietGevonden.length ? `Niet gevonden in het team: ${f.nietGevonden.join(', ')}.` : null].filter(Boolean).join(' ')}</span>
        </div>
      )}

      <div>
        <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Titel</div>
        <input value={f.titel} onChange={(e) => zet('titel', e.target.value)} className="input-base text-base" aria-label="Titel" maxLength={500} />
      </div>
      <div>
        <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Beschrijving</div>
        <textarea value={f.beschrijving ?? ''} onChange={(e) => zet('beschrijving', e.target.value || null)} rows={Math.min(8, Math.max(3, (f.beschrijving ?? '').split('\n').length + 1))} className="input-base text-sm leading-relaxed" aria-label="Beschrijving" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5 flex items-center gap-1"><Clock className="h-3 w-3" />Deadline</div>
          <div className="flex flex-wrap gap-1.5">
            <input type="date" value={f.deadline_dag ?? ''} onChange={(e) => setF((x) => ({ ...x, deadline_dag: e.target.value || null, deadline_uur: e.target.value ? x.deadline_uur ?? '17:00' : null }))} className="input-base !py-1 !px-2 text-sm !w-[9.5rem]" aria-label="Datum deadline" />
            <input type="time" step={300} value={hm(f.deadline_uur)} onChange={(e) => setF((x) => ({ ...x, deadline_uur: e.target.value || null, deadline_dag: x.deadline_dag ?? vandaag() }))} className="input-base !py-1 !px-2 text-sm !w-[6.5rem]" aria-label="Uur deadline" />
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            <button type="button" onClick={() => setF((x) => ({ ...x, deadline_dag: null, deadline_uur: null }))} className={chip(!deadlineIso)}>Geen</button>
            {snelleDeadlines().map((s) => {
              const aan = !!deadlineIso && Date.parse(deadlineIso) === Date.parse(s.iso)
              return <button key={s.label} type="button" onClick={() => setF((x) => ({ ...x, deadline_dag: dag(s.iso), deadline_uur: uur(s.iso) }))} className={chip(aan)}>{s.label}</button>
            })}
          </div>
        </div>
        <div>
          <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5 flex items-center gap-1"><CalendarPlus className="h-3 w-3" />Ingepland op (niet verplicht)</div>
          <div className="flex flex-wrap gap-1.5">
            <input type="date" value={f.dag ?? ''} onChange={(e) => setF((x) => ({ ...x, dag: e.target.value || null, ...(e.target.value ? {} : { van: null, tot: null }) }))} className="input-base !py-1 !px-2 text-sm !w-[9.5rem]" aria-label="Datum" />
            {f.dag && <>
              <input type="time" step={300} value={hm(f.van)} onChange={(e) => zet('van', e.target.value || null)} className="input-base !py-1 !px-2 text-sm !w-[6.5rem]" aria-label="Van" />
              {f.van && <input type="time" step={300} value={hm(f.tot)} onChange={(e) => zet('tot', e.target.value || null)} className="input-base !py-1 !px-2 text-sm !w-[6.5rem]" aria-label="Tot" />}
            </>}
          </div>
          <div className="flex flex-wrap gap-1.5 mt-1.5">
            {!f.dag && <>
              <button type="button" onClick={() => zet('dag', vandaag())} className={chip(false)}>Vandaag</button>
              <button type="button" onClick={() => zet('dag', plusDagen(vandaag(), 1))} className={chip(false)}>Morgen</button>
            </>}
            {f.dag && f.van && (['taak', 'meeting'] as const).map((s) => <button key={s} type="button" onClick={() => zet('soort', s)} className={chip(f.soort === s)}>{s === 'meeting' ? 'Afspraak' : 'Taak met uur'}</button>)}
          </div>
        </div>
      </div>

      <div>
        <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Wie</div>
        <WieKiezer boom={boom} gekozen={f.toegewezen} onWissel={(p) => zet('toegewezen', f.toegewezen.includes(p) ? f.toegewezen.filter((x) => x !== p) : [...f.toegewezen, p])} />
      </div>

      <div>
        <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Map (klant)</div>
        <button type="button" onClick={() => setMapOpen(!mapOpen)} className={`w-full rounded-xl border px-3 py-2.5 text-left text-sm hover:border-gray-400 ${mapNodig && !f.lijst_id ? 'border-red-400 bg-red-50/40' : 'border-gray-200'} ${focusRing}`}>
          <MapLabel boom={boom} lijstId={f.lijst_id} leeg="Kies de map, bv. Group Cé of Pitch Please" />
        </button>
        {mapOpen && <div className="mt-1.5 rounded-xl border border-gray-200"><MapKiezer vol boom={boom} gekozen={f.lijst_id} onKies={(l) => { zet('lijst_id', l); setMapNodig(false); setMapOpen(false) }} /></div>}
        {mapNodig && !f.lijst_id && <p className="text-xs text-red-700 mt-1">Kies eerst bij welke map deze taak hoort.</p>}
      </div>

      <div>
        <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Label</div>
        <LabelKeuze boom={boom} gekozen={labels} voorstel={voorstel} onZet={(l) => { setLabels(l); setLabelsGekozen(true) }} />
      </div>

      <button type="button" onClick={() => zet('urgent', !f.urgent)} aria-pressed={f.urgent}
        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs ${f.urgent ? 'bg-red-50 border-red-300 text-red-700' : 'border-gray-200 text-gray-600 hover:border-gray-400'} ${focusRing}`}>
        <Flag className={`h-3.5 w-3.5 ${f.urgent ? 'fill-red-600 text-red-600' : ''}`} />Dringend
      </button>
    </Modal>
  )
}

/**
 * Snelle knoppen buiten de agenda (Command Center): taak inspreken en een
 * meeting inplannen. De agenda (mappen, team) laadt pas bij de klik.
 */
export function SnelleAgendaKnoppen({ magToevoegen, magMeetings }: { magToevoegen: boolean; magMeetings: boolean }) {
  const [boom, setBoom] = useState<BoomData | null>(null)
  const [open, setOpen] = useState(false)
  const [laden, setLaden] = useState(false)
  const start = async () => {
    if (boom) { setOpen(true); return }
    setLaden(true)
    try { setBoom(await api<BoomData>('/api/admin/agenda?boom=1')); setOpen(true) } catch (e) { toast.error(e instanceof Error ? e.message : 'De agenda kon niet laden.') } finally { setLaden(false) }
  }
  if (!magToevoegen && !magMeetings) return null
  return (
    <div className="flex flex-wrap gap-2">
      {magToevoegen && (
        <button type="button" onClick={start} disabled={laden} className="btn-primary !py-2">
          {laden ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}Taak inspreken
        </button>
      )}
      {magMeetings && <a href="/admin/meetings?plan=1" className="btn-secondary !py-2"><CalendarPlus className="h-4 w-4" />Meeting inplannen</a>}
      {magToevoegen && <a href="/admin/agenda?afsluiten=1" className="btn-secondary !py-2"><MoonStar className="h-4 w-4" />Dag afsluiten</a>}
      {open && boom && (
        <InspreekVenster boom={boom} onSluit={() => setOpen(false)}
          onToegevoegd={(id) => {
            setOpen(false)
            window.dispatchEvent(new CustomEvent('agenda:gewijzigd'))
            toast.success('Staat in de agenda.', { action: { label: 'Openen', onClick: () => { window.location.href = `/admin/agenda?item=${id}` } } })
          }} />
      )}
    </div>
  )
}

