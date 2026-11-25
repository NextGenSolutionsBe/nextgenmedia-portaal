'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, ArrowRight, CalendarDays, MessageSquarePlus, Plus, Video, Undo2, CheckCheck, ListTree } from 'lucide-react'
import { Modal } from '@/app/admin/materiaal/dialogen'
import { DicteerKnop } from '@/components/admin/dicteer-knop'
import { vandaag, plusDagen, kortDag, zoneNaarIso, uur, type Item } from '@/lib/agenda/model'
import { afTeSluiten, naarDag, volgendeWerkdag, laatsteDag, hoeLangOpen, notitieErbij, DAGEN_TERUG } from '@/lib/agenda/dag-afsluiten'
import { actie, api, Popover, MapKiezer, MapLabel, focusRing, type BoomData } from './gedeeld'
import { DeadlineLabel } from './kalender'

type Uitkomst = { soort: 'gedaan' } | { soort: 'verplaatst'; naar: string }

const dagNaam = (d: string) => (d === vandaag() ? 'vandaag' : d === plusDagen(vandaag(), 1) ? 'morgen' : kortDag(d))

/**
 * Dag afsluiten: alles van jou dat nog open staat (vandaag en de voorbije 30 dagen)
 * en je meetings van vandaag. Per taak: gedaan, naar de volgende werkdag of een
 * andere dag, en eventueel een notitie (typen of inspreken). Onderaan taken voor
 * morgen toevoegen. Elke klik bewaart meteen en kan ongedaan gemaakt worden.
 */
export function DagAfsluiten({ boom, onSluit, onVernieuw }: { boom: BoomData; onSluit: () => void; onVernieuw: () => void }) {
  const d = vandaag()
  const morgen = volgendeWerkdag(d)
  const [items, setItems] = useState<Item[] | null>(null)
  const [uitkomst, setUitkomst] = useState<Record<string, Uitkomst>>({})
  const [bezig, setBezig] = useState<Set<string>>(new Set())
  const [allesBezig, setAllesBezig] = useState(false)
  const [gewijzigd, setGewijzigd] = useState(false)

  useEffect(() => {
    const van = zoneNaarIso(plusDagen(d, -DAGEN_TERUG), '00:00'), tot = zoneNaarIso(plusDagen(d, 1), '00:00')
    api<{ items: Item[] }>(`/api/admin/agenda?van=${encodeURIComponent(van)}&tot=${encodeURIComponent(tot)}`)
      .then((j) => setItems(j.items))
      .catch((e) => { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setItems([]) })
  }, [d])

  const { taken, meetings } = useMemo(() => afTeSluiten(items ?? [], { ik: boom.ik, dag: d }), [items, boom.ik, d])
  const nogTeDoen = taken.filter((t) => !uitkomst[t.id])
  const mag = !!boom.rechten.aanpassen

  const metBezig = async (id: string, f: () => Promise<void>) => {
    setBezig((b) => new Set(b).add(id))
    try { await f(); setGewijzigd(true) } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBezig((b) => { const n = new Set(b); n.delete(id); return n }) }
  }
  const zetUitkomst = (id: string, u: Uitkomst | null) => setUitkomst((x) => { const n = { ...x }; if (u) n[id] = u; else delete n[id]; return n })

  const gedaan = (i: Item) => metBezig(i.id, async () => {
    await actie({ actie: 'item.wijzig', id: i.id, status: 'klaar' })
    zetUitkomst(i.id, { soort: 'gedaan' })
  })
  const verplaats = (i: Item, naar: string) => metBezig(i.id, async () => {
    const v = naarDag(i, naar)
    if (!v) throw new Error('Deze taak heeft geen datum.')
    await actie({ actie: 'item.wijzig', id: i.id, ...v })
    zetUitkomst(i.id, { soort: 'verplaatst', naar })
  })
  const terug = (i: Item) => metBezig(i.id, async () => {
    const u = uitkomst[i.id]
    if (u?.soort === 'gedaan') await actie({ actie: 'item.wijzig', id: i.id, status: i.status })
    else await actie({ actie: 'item.wijzig', id: i.id, start_op: i.start_op, eind_op: i.eind_op, heel_dag: i.heel_dag, deadline_op: i.deadline_op })
    zetUitkomst(i.id, null)
  })
  const allesNaarMorgen = async () => {
    const lijst = nogTeDoen.filter((t) => !bezig.has(t.id))
    if (!lijst.length) return
    setAllesBezig(true)
    let ok = 0
    for (let n = 0; n < lijst.length; n += 5) {
      const res = await Promise.allSettled(lijst.slice(n, n + 5).map(async (i) => {
        const v = naarDag(i, morgen)
        if (!v) return
        await actie({ actie: 'item.wijzig', id: i.id, ...v })
        zetUitkomst(i.id, { soort: 'verplaatst', naar: morgen })
        ok++
      }))
      if (res.some((r) => r.status === 'rejected')) toast.error('Niet alles kon verplaatst worden. Probeer de rest apart.')
    }
    setAllesBezig(false); setGewijzigd(true)
    if (ok) toast.success(`${ok} ${ok === 1 ? 'taak' : 'taken'} naar ${dagNaam(morgen)}.`)
  }
  const meetingKlaar = (i: Item) => metBezig(i.id, async () => {
    const klaar = i.status !== 'klaar'
    if (i.bron === 'meeting') await actie({ actie: 'meeting.klaar', id: i.id, klaar })
    else await actie({ actie: 'item.wijzig', id: i.id, status: klaar ? 'klaar' : 'open' })
    setItems((l) => l?.map((x) => (x.id === i.id ? { ...x, status: klaar ? 'klaar' : 'open' } : x)) ?? null)
  })

  const sluit = () => { if (gewijzigd) onVernieuw(); onSluit() }
  const afgehandeld = taken.length - nogTeDoen.length

  return (
    <Modal titel="Dag afsluiten" breed onSluit={sluit}
      sub={items ? `${kortDag(d)} · ${nogTeDoen.length ? `nog ${nogTeDoen.length} open` : 'niets meer open'}${meetings.length ? ` · ${meetings.length} meeting${meetings.length > 1 ? 's' : ''}` : ''}` : kortDag(d)}
      voet={<button type="button" onClick={sluit} className="btn-primary">{nogTeDoen.length ? 'Sluiten' : 'Dag afgesloten'}</button>}>
      {!items && <div className="py-12 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
      {items && (
        <>
          {meetings.length > 0 && (
            <section>
              <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">Meetings van vandaag</div>
              <ul className="space-y-1.5">
                {meetings.map((m) => <MeetingRij key={m.id} m={m} boom={boom} morgen={morgen} mag={mag} bezig={bezig.has(m.id)} onKlaar={() => meetingKlaar(m)} onTaak={() => setGewijzigd(true)} />)}
              </ul>
            </section>
          )}

          <section>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-1.5">
              <div className="label-mono text-[10px] uppercase text-gray-500">Open taken{afgehandeld ? ` · ${afgehandeld} afgehandeld` : ''}</div>
              {mag && nogTeDoen.length > 1 && (
                <button type="button" onClick={allesNaarMorgen} disabled={allesBezig} className={`btn-secondary !py-1.5 !text-xs ${focusRing}`}>
                  {allesBezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}Alles wat open is naar {dagNaam(morgen)}
                </button>
              )}
            </div>
            {!taken.length && (
              <div className="rounded-xl border border-dashed border-gray-200 px-4 py-6 text-center text-sm text-gray-500">
                <CheckCheck className="h-5 w-5 mx-auto mb-1 text-gray-400" />Er staat niets meer open van vandaag of eerder.
              </div>
            )}
            <ul className="space-y-1.5">
              {taken.map((t) => (
                <TaakRij key={t.id} t={t} boom={boom} d={d} morgen={morgen} mag={mag} uitkomst={uitkomst[t.id] ?? null} bezig={bezig.has(t.id)}
                  onGedaan={() => gedaan(t)} onNaar={(naar) => verplaats(t, naar)} onTerug={() => terug(t)} onNotitie={() => setGewijzigd(true)} />
              ))}
            </ul>
          </section>

          {boom.rechten.toevoegen && <SnelToevoegen boom={boom} standaardDag={morgen} titel={`Taken voor ${dagNaam(morgen)} toevoegen`} onToegevoegd={() => setGewijzigd(true)} />}
        </>
      )}
    </Modal>
  )
}

function Knop({ onClick, disabled, children, titel, donker }: { onClick: () => void; disabled?: boolean; children: React.ReactNode; titel?: string; donker?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} title={titel}
      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium disabled:opacity-50 ${donker ? 'bg-gray-900 text-white border-gray-900 hover:bg-black' : 'bg-white border-gray-200 text-gray-800 hover:border-gray-400'} ${focusRing}`}>
      {children}
    </button>
  )
}

function TaakRij({ t, boom, d, morgen, mag, uitkomst, bezig, onGedaan, onNaar, onTerug, onNotitie }: {
  t: Item; boom: BoomData; d: string; morgen: string; mag: boolean; uitkomst: Uitkomst | null; bezig: boolean
  onGedaan: () => void; onNaar: (d: string) => void; onTerug: () => void; onNotitie: () => void
}) {
  const [andere, setAndere] = useState(false)
  const [notitieOpen, setNotitieOpen] = useState(false)
  const [notitie, setNotitie] = useState('')
  const [bewaart, setBewaart] = useState(false)
  const [notitieKlaar, setNotitieKlaar] = useState(false)
  const laatste = laatsteDag(t)
  const ouder = laatste && laatste < d
  const bewaarNotitie = async () => {
    if (!notitie.trim()) return
    setBewaart(true)
    try {
      // Eerst de huidige beschrijving (die zit niet in de kalenderlijst), dan de notitie eronder.
      const j = await api<{ item: Item }>(`/api/admin/agenda?item=${t.id}`)
      await actie({ actie: 'item.wijzig', id: t.id, beschrijving: notitieErbij(j.item.beschrijving, notitie, d) })
      setNotitie(''); setNotitieOpen(false); setNotitieKlaar(true); onNotitie()
      toast.success('Notitie bij de taak gezet.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBewaart(false) }
  }
  return (
    <li className={`rounded-xl border px-3 py-2.5 ${uitkomst ? 'border-gray-100 bg-gray-50/60' : 'border-gray-200 bg-white'}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1 basis-[14rem]">
          <div className={`text-sm font-medium truncate ${uitkomst?.soort === 'gedaan' ? 'line-through text-gray-400' : 'text-gray-900'}`}>{t.titel}</div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-0.5 text-[11px] text-gray-500">
            {t.lijst_id && <span className="inline-flex items-center gap-1 min-w-0 max-w-full"><MapLabel boom={boom} lijstId={t.lijst_id} leeg="" /></span>}
            {ouder && !uitkomst && <span className="font-semibold text-red-700">Stond op {kortDag(laatste!)} ({hoeLangOpen(laatste!)})</span>}
            {t.deadline_op && !uitkomst && <DeadlineLabel i={t} lang />}
            {notitieKlaar && <span className="text-gray-600">Notitie bewaard</span>}
          </div>
        </div>
        {uitkomst ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1 text-xs font-semibold text-gray-700">
              {uitkomst.soort === 'gedaan' ? <><Check className="h-3.5 w-3.5" />Gedaan</> : <><ArrowRight className="h-3.5 w-3.5" />Naar {dagNaam(uitkomst.naar)}</>}
            </span>
            {mag && <Knop onClick={onTerug} disabled={bezig} titel="Ongedaan maken">{bezig ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}Ongedaan</Knop>}
          </div>
        ) : mag && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Knop onClick={onGedaan} disabled={bezig} donker>{bezig ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}Gedaan</Knop>
            <Knop onClick={() => onNaar(morgen)} disabled={bezig} titel={`Naar ${kortDag(morgen)}`}><ArrowRight className="h-3 w-3" />{morgen === plusDagen(vandaag(), 1) ? 'Morgen' : kortDag(morgen)}</Knop>
            <div className="relative">
              <Knop onClick={() => setAndere(!andere)} disabled={bezig}><CalendarDays className="h-3 w-3" />Andere dag</Knop>
              {andere && (
                <div className="absolute right-0 top-full mt-1 z-20 rounded-xl border border-gray-200 bg-white p-2 shadow-lg">
                  <input type="date" min={vandaag()} autoFocus aria-label="Naar welke dag" className="input-base !py-1 !px-2 text-sm !w-[10rem]"
                    onChange={(e) => { if (e.target.value) { setAndere(false); onNaar(e.target.value) } }} />
                </div>
              )}
            </div>
            <Knop onClick={() => setNotitieOpen(!notitieOpen)} titel="Notitie of briefing bij deze taak"><MessageSquarePlus className="h-3 w-3" />Notitie</Knop>
          </div>
        )}
      </div>
      {notitieOpen && !uitkomst && (
        <div className="mt-2 space-y-1.5">
          <div className="flex items-start gap-1.5">
            <textarea autoFocus value={notitie} onChange={(e) => setNotitie(e.target.value)} rows={2} maxLength={5000}
              onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') bewaarNotitie() }}
              className="input-base text-sm flex-1" placeholder="Hoe staat het? Bv. wacht op de foto's van de klant." aria-label={`Notitie bij ${t.titel}`} />
            <DicteerKnop zet={setNotitie} context={t.titel} klein />
          </div>
          <div className="flex justify-end gap-1.5">
            <button type="button" onClick={() => { setNotitieOpen(false); setNotitie('') }} className="btn-secondary !py-1 !text-xs">Annuleren</button>
            <button type="button" onClick={bewaarNotitie} disabled={!notitie.trim() || bewaart} className="btn-primary !py-1 !text-xs">{bewaart && <Loader2 className="h-3 w-3 animate-spin" />}Notitie bewaren</button>
          </div>
        </div>
      )}
    </li>
  )
}

function MeetingRij({ m, boom, morgen, mag, bezig, onKlaar, onTaak }: { m: Item; boom: BoomData; morgen: string; mag: boolean; bezig: boolean; onKlaar: () => void; onTaak: () => void }) {
  const [taken, setTaken] = useState(false)
  const klaar = m.status === 'klaar'
  return (
    <li className="rounded-xl border border-gray-200 bg-white px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Video className="h-4 w-4 shrink-0 text-gray-400" />
        <div className="min-w-0 flex-1 basis-[12rem]">
          <div className={`text-sm font-medium truncate ${klaar ? 'line-through text-gray-400' : 'text-gray-900'}`}>{m.titel}</div>
          <div className="text-[11px] text-gray-500">{m.start_op ? uur(m.start_op) : ''}{m.eind_op && m.start_op ? `–${uur(m.eind_op)}` : ''}</div>
        </div>
        {mag && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Knop onClick={onKlaar} disabled={bezig} donker={!klaar}>{bezig ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}{klaar ? 'Terug open' : 'Gedaan'}</Knop>
            {boom.rechten.toevoegen && <Knop onClick={() => setTaken(!taken)}><Plus className="h-3 w-3" />Taken uit deze meeting</Knop>}
          </div>
        )}
      </div>
      {taken && <div className="mt-2"><SnelToevoegen boom={boom} standaardDag={morgen} standaardLijst={m.bron === 'ag' ? m.lijst_id : null} compact titel={null} plaatshouder="Wat moet er gebeuren na deze meeting?" context={m.titel} onToegevoegd={onTaak} /></div>}
    </li>
  )
}

/** Snel taken toevoegen: titel (typen of inspreken), dag en eventueel een map. Enter = toevoegen. */
function SnelToevoegen({ boom, standaardDag, standaardLijst = null, titel, plaatshouder = 'Wat moet er gebeuren?', context = null, compact = false, onToegevoegd }: {
  boom: BoomData; standaardDag: string; standaardLijst?: string | null; titel: string | null; plaatshouder?: string; context?: string | null; compact?: boolean; onToegevoegd: () => void
}) {
  const [tekst, setTekst] = useState('')
  const [dagK, setDagK] = useState(standaardDag)
  const [lijst, setLijst] = useState<string | null>(standaardLijst)
  const [mapOpen, setMapOpen] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [toegevoegd, setToegevoegd] = useState<{ id: string; titel: string; dag: string }[]>([])
  const sluitMap = useCallback(() => setMapOpen(false), [])
  const keuzes = useMemo(() => {
    const v = vandaag()
    return [...new Set([v, plusDagen(v, 1), volgendeWerkdag(v), volgendeWerkdag(volgendeWerkdag(v))])]
  }, [])
  const voegToe = async () => {
    const t = tekst.trim()
    if (!t || bezig) return
    setBezig(true)
    try {
      const r = await actie({ actie: 'item.nieuw', titel: t, soort: 'taak', start_op: null, eind_op: zoneNaarIso(dagK, '00:00'), heel_dag: true, lijst_id: lijst, toegewezen: [boom.ik] })
      setToegevoegd((x) => [...x, { id: r.id ?? t, titel: t, dag: dagK }]); setTekst(''); onToegevoegd()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setBezig(false) }
  }
  return (
    <section className={compact ? '' : 'rounded-xl border border-gray-200 bg-white p-3'}>
      {titel && <div className="label-mono text-[10px] uppercase text-gray-500 mb-1.5">{titel}</div>}
      <div className="flex items-center gap-1.5">
        <input value={tekst} onChange={(e) => setTekst(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') voegToe() }} maxLength={500}
          className="input-base text-sm flex-1" placeholder={plaatshouder} aria-label={plaatshouder} />
        <DicteerKnop zet={setTekst} context={context} klein />
        <button type="button" onClick={voegToe} disabled={!tekst.trim() || bezig} className="btn-primary !py-2 !px-3 !text-xs shrink-0">{bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Toevoegen</button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 mt-2">
        {keuzes.map((k) => (
          <button key={k} type="button" onClick={() => setDagK(k)} aria-pressed={dagK === k}
            className={`rounded-full border px-2.5 py-1 text-xs ${dagK === k ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-700 hover:border-gray-400'} ${focusRing}`}>
            {k === vandaag() ? 'Vandaag' : k === plusDagen(vandaag(), 1) ? 'Morgen' : kortDag(k)}
          </button>
        ))}
        <input type="date" min={vandaag()} value={dagK} onChange={(e) => { if (e.target.value) setDagK(e.target.value) }} aria-label="Andere dag" className="input-base !py-1 !px-2 text-xs !w-[9.5rem]" />
        <div className="relative">
          <button type="button" onClick={() => setMapOpen(!mapOpen)} className={`inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs text-gray-700 hover:border-gray-400 max-w-[16rem] ${focusRing}`}>
            {lijst ? <MapLabel boom={boom} lijstId={lijst} leeg="" /> : <><ListTree className="h-3.5 w-3.5" />Map kiezen</>}
          </button>
          <Popover open={mapOpen} onSluit={sluitMap}><MapKiezer boom={boom} gekozen={lijst} leeg="Geen map (enkel in de agenda)" onKies={(l) => { setLijst(l); sluitMap() }} /></Popover>
        </div>
      </div>
      {toegevoegd.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {toegevoegd.map((x) => <li key={x.id} className="text-xs text-gray-600 flex items-center gap-1.5"><Check className="h-3.5 w-3.5 text-gray-900" />{x.titel}<span className="text-gray-400">· {dagNaam(x.dag)}</span></li>)}
        </ul>
      )}
    </section>
  )
}
