'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ChevronLeft, ChevronRight, Loader2, Plus, Printer, PanelLeft, Search, Tag, Building2, Eye, EyeOff, Mail, X, Users, List as ListIcon,
} from 'lucide-react'
import { PersoonFoto } from '@/components/admin/persoon-foto'
import { zoekVeld } from '@/lib/zoekveld'
import {
  vandaag, verschuif, bereikVan, dagenVan, kleurVan, klantVan, kortDag, dag as dagVan, uur as uurVan, KLEUR_VOLGENS,
  type Item, type Weergave, type KleurVolgens,
} from '@/lib/agenda/model'
import { PlanVenster, DetailVenster, AnnuleerVenster, api as meetingApi, type Opties, type Meeting } from '@/app/admin/meetings/meetings-client'
import { Modal } from '@/app/admin/materiaal/dialogen'
import { api, actie, kleurContext, padVan, Popover, PersonenLijst, focusRing, type BoomData } from './gedeeld'
import { Kalender, type Verplaatsing, type NieuwMoment } from './kalender'
import { Boom, type Keuze } from './boom'
import { ItemVenster, KlantLijst } from './item-venster'
import { LijstWeergave, wanneer } from './lijst'
import { DocWeergave } from './doc'
import { NieuwVenster, AfgevinktPaneel, PrullenbakPaneel, MailPaneel, InstellingenPaneel } from './extra'

type Modus = Weergave | 'lijst'
type Paneel = null | 'klaar' | 'prullenbak' | 'instellingen' | 'mail'
type MeetingVenster =
  | null
  | { soort: 'plan'; wat: 'algemeen' | 'klant'; m: NieuwMoment }
  | { soort: 'detail'; id: string }
  | { soort: 'wijzig'; meeting: Meeting }
  | { soort: 'annuleer'; meeting: Meeting }

const VOORKEUR = 'ngm-agenda-voorkeur'
type Voorkeur = { modus?: Modus; personen?: string[]; kleur?: KleurVolgens; klaar?: boolean; boom?: boolean }
const leesVoorkeur = (): Voorkeur => { try { return JSON.parse(localStorage.getItem(VOORKEUR) ?? '{}') as Voorkeur } catch { return {} } }
const hhmm = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

function periodeTitel(w: Weergave, d: string): string {
  if (w === 'dag') return new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
  if (w === 'maand') return new Date(`${d.slice(0, 7)}-15T12:00:00Z`).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const dagen = dagenVan('week', d)
  const a = new Date(`${dagen[0]}T12:00:00Z`), b = new Date(`${dagen[6]}T12:00:00Z`)
  const zelfdeMaand = a.getUTCMonth() === b.getUTCMonth()
  return `${a.getUTCDate()}${zelfdeMaand ? '' : ` ${a.toLocaleDateString('nl-BE', { month: 'short', timeZone: 'UTC' })}`} – ${b.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}`
}

export function AgendaApp() {
  const [boom, setBoom] = useState<BoomData | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [keuze, setKeuze] = useState<Keuze>(null)
  const [modus, setModus] = useState<Modus>('week')
  const [datum, setDatum] = useState(vandaag())
  const [personen, setPersonen] = useState<string[]>([])
  const [labels, setLabels] = useState<string[]>([])
  const [klant, setKlant] = useState<string | null>(null)
  const [toonKlaar, setToonKlaar] = useState(false)
  const [kleurVolgens, setKleurVolgens] = useState<KleurVolgens>('klant')
  const [toonBoom, setToonBoom] = useState(true)
  const [items, setItems] = useState<Item[] | null>(null)
  const [laden, setLaden] = useState(false)
  const [lijstItems, setLijstItems] = useState<Item[] | null>(null)
  const [openItem, setOpenItem] = useState<string | null>(null)
  const [nieuw, setNieuw] = useState<NieuwMoment | null>(null)
  const [paneel, setPaneel] = useState<Paneel>(null)
  const [mv, setMv] = useState<MeetingVenster>(null)
  const [opties, setOpties] = useState<Opties | null>(null)
  const [pop, setPop] = useState<null | 'personen' | 'labels' | 'klant' | 'zoek'>(null)
  const sluitPop = useCallback(() => setPop(null), [])
  const geladen = useRef(false)

  // ── Voorkeuren en adresbalk ────────────────────────────────────────────────
  useEffect(() => {
    const v = leesVoorkeur()
    const smal = window.innerWidth < 768
    if (v.modus) setModus(v.modus === 'lijst' ? 'week' : v.modus); else if (smal) setModus('dag')
    if (v.personen) setPersonen(v.personen)
    if (v.kleur) setKleurVolgens(v.kleur)
    if (typeof v.klaar === 'boolean') setToonKlaar(v.klaar)
    setToonBoom(smal ? false : v.boom !== false)
    const q = new URLSearchParams(window.location.search)
    for (const s of ['lijst', 'map', 'space', 'doc'] as const) { const id = q.get(s); if (id) setKeuze({ soort: s, id }) }
    if (q.get('item')) setOpenItem(q.get('item'))
    if (q.get('datum') && /^\d{4}-\d{2}-\d{2}$/.test(q.get('datum')!)) setDatum(q.get('datum')!)
    if (q.get('paneel') === 'mail') setPaneel('mail')
    geladen.current = true
  }, [])
  const bewaarVoorkeur = (v: Voorkeur) => { try { localStorage.setItem(VOORKEUR, JSON.stringify({ ...leesVoorkeur(), ...v })) } catch { /* */ } }
  useEffect(() => {
    if (!geladen.current) return
    const q = new URLSearchParams()
    if (keuze) q.set(keuze.soort, keuze.id)
    if (openItem) q.set('item', openItem)
    if (datum !== vandaag()) q.set('datum', datum)
    const url = `${window.location.pathname}${q.toString() ? `?${q}` : ''}`
    if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, '', url)
  }, [keuze, openItem, datum])

  // ── Laden ──────────────────────────────────────────────────────────────────
  const laadBoom = useCallback(async () => {
    try { setBoom(await api<BoomData>('/api/admin/agenda?boom=1')); setFout(null) } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => { laadBoom() }, [laadBoom])

  const weergave: Weergave = modus === 'lijst' ? 'week' : modus
  const bereik = useMemo(() => bereikVan(weergave, datum), [weergave, datum])
  const vraag = useRef(0)
  const laadItems = useCallback(async () => {
    const n = ++vraag.current
    setLaden(true)
    try {
      const j = await api<{ items: Item[] }>(`/api/admin/agenda?van=${encodeURIComponent(bereik.van)}&tot=${encodeURIComponent(bereik.tot)}`)
      if (n === vraag.current) setItems(j.items)
    } catch (e) { if (n === vraag.current) toast.error(e instanceof Error ? e.message : 'Agenda laden mislukt') } finally { if (n === vraag.current) setLaden(false) }
  }, [bereik])
  useEffect(() => { if (modus !== 'lijst') laadItems() }, [laadItems, modus])

  const container = keuze && keuze.soort !== 'doc' ? keuze : null
  const laadLijst = useCallback(async () => {
    if (!container) { setLijstItems(null); return }
    try { const j = await api<{ items: Item[] }>(`/api/admin/agenda?container=${container.soort}&id=${container.id}`); setLijstItems(j.items) } catch (e) { toast.error(e instanceof Error ? e.message : 'Lijst laden mislukt') }
  }, [container?.soort, container?.id]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setLijstItems(null); if (container && modus === 'lijst') laadLijst() }, [laadLijst, modus]) // eslint-disable-line react-hooks/exhaustive-deps

  // Bij een lijst, map of space standaard de lijstweergave; terug naar de volledige agenda = kalender.
  const vorigeKeuze = useRef<string | null>(null)
  useEffect(() => {
    const sleutel = keuze ? `${keuze.soort}:${keuze.id}` : null
    if (sleutel === vorigeKeuze.current) return
    vorigeKeuze.current = sleutel
    if (keuze && keuze.soort !== 'doc') setModus('lijst')
    else if (!keuze && modus === 'lijst') setModus(leesVoorkeur().modus && leesVoorkeur().modus !== 'lijst' ? leesVoorkeur().modus as Weergave : 'week')
  }, [keuze]) // eslint-disable-line react-hooks/exhaustive-deps

  // Terug naar het venster = vers laden (iemand anders kan iets aangepast hebben).
  useEffect(() => {
    const f = () => { if (document.visibilityState === 'visible') { if (modus === 'lijst') laadLijst(); else laadItems() } }
    document.addEventListener('visibilitychange', f)
    return () => document.removeEventListener('visibilitychange', f)
  }, [modus, laadItems, laadLijst])

  const vernieuw = useCallback(() => { laadBoom(); if (modus === 'lijst') laadLijst(); else laadItems() }, [laadBoom, laadItems, laadLijst, modus])

  // ── Filteren ───────────────────────────────────────────────────────────────
  const ctx = useMemo(() => (boom ? kleurContext(boom) : null), [boom])
  const personenMap = useMemo(() => new Map((boom?.personen ?? []).map((p) => [p.id, p])), [boom])
  const lijstenVanKeuze = useMemo(() => {
    if (!boom || !container) return null
    if (container.soort === 'lijst') return [container.id]
    if (container.soort === 'space') return boom.lijsten.filter((l) => l.space_id === container.id).map((l) => l.id)
    const onder = new Set([container.id])
    for (let i = 0; i < 5; i++) for (const m of boom.mappen) if (m.parent_id && onder.has(m.parent_id)) onder.add(m.id)
    return boom.lijsten.filter((l) => l.map_id && onder.has(l.map_id)).map((l) => l.id)
  }, [boom, container])
  /** `metKlaar`: afgevinkte altijd meegeven (de lijstweergave toont ze ingeklapt onderaan). */
  const filter = useCallback((l: Item[], metKlaar = false) => {
    const inLijst = lijstenVanKeuze ? new Set(lijstenVanKeuze) : null
    return l.filter((i) =>
      (metKlaar || toonKlaar || i.status !== 'klaar' || i.soort === 'meeting') &&
      (!personen.length || i.toegewezen.some((p) => personen.includes(p))) &&
      (!labels.length || i.labels.some((x) => labels.includes(x))) &&
      (!klant || (ctx && klantVan(i, ctx) === klant)) &&
      (!inLijst || (i.lijst_id && inLijst.has(i.lijst_id))))
  }, [toonKlaar, personen, labels, klant, ctx, lijstenVanKeuze])
  const zichtbaar = useMemo(() => filter(items ?? []), [filter, items])
  const kleur = useCallback((i: Item) => (ctx ? kleurVan(i, ctx, kleurVolgens) : '#e5e7eb'), [ctx, kleurVolgens])

  // ── Acties op items ────────────────────────────────────────────────────────
  const pasLokaalAan = (id: string, velden: Partial<Item>) => {
    setItems((l) => l?.map((x) => (x.id === id && x.bron === 'ag' ? { ...x, ...velden } : x)) ?? null)
    setLijstItems((l) => l?.map((x) => (x.id === id ? { ...x, ...velden } : x)) ?? null)
  }
  const wisselKlaar = async (i: Item) => {
    if (!boom?.rechten.aanpassen) return
    const status = i.status === 'klaar' ? 'open' : 'klaar'
    pasLokaalAan(i.id, { status, afgerond_op: status === 'klaar' ? new Date().toISOString() : null })
    try { await actie({ actie: 'item.wijzig', id: i.id, status }) } catch (e) { pasLokaalAan(i.id, { status: i.status, afgerond_op: i.afgerond_op }); toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }
  const verplaats = async (i: Item, v: Verplaatsing) => {
    const oud = { start_op: i.start_op, eind_op: i.eind_op, heel_dag: i.heel_dag }
    pasLokaalAan(i.id, v)
    try {
      await actie({ actie: 'item.wijzig', id: i.id, ...v })
      const wanneerTekst = v.heel_dag ? kortDag(dagVan(v.eind_op ?? v.start_op ?? new Date().toISOString())) : `${kortDag(dagVan(v.start_op!))} ${uurVan(v.start_op!)}`
      toast.success(`Verplaatst naar ${wanneerTekst}`, { action: { label: 'Ongedaan maken', onClick: () => { pasLokaalAan(i.id, oud); actie({ actie: 'item.wijzig', id: i.id, ...oud }).catch(() => toast.error('Terugzetten mislukt')) } } })
    } catch (e) { pasLokaalAan(i.id, oud); toast.error(e instanceof Error ? e.message : 'Verplaatsen mislukt') }
  }
  const open = (i: Item) => { if (i.bron === 'meeting') { laadOpties(); setMv({ soort: 'detail', id: i.id }) } else setOpenItem(i.id) }
  const laadOpties = useCallback(() => { if (!opties) meetingApi<Opties>('/api/admin/meetings?opties=1').then(setOpties).catch(() => toast.error('De Meeting Inplanner kon niet laden.')) }, [opties])

  const nieuwDoc = async (waar: { space_id?: string; map_id?: string; lijst_id?: string }) => {
    try { const r = await actie({ actie: 'doc.nieuw', titel: 'Nieuw document', ...waar }); await laadBoom(); if (r.id) setKeuze({ soort: 'doc', id: r.id }) } catch (e) { toast.error(e instanceof Error ? e.message : 'Aanmaken mislukt') }
  }

  // ── Sneltoetsen: ← → vorige/volgende, T vandaag, D/W/M weergave ─────────────
  useEffect(() => {
    const t = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el?.closest?.('input,textarea,select,[contenteditable="true"]') || e.metaKey || e.ctrlKey || e.altKey || openItem || nieuw || paneel || mv) return
      if (modus === 'lijst' || keuze?.soort === 'doc') return
      if (e.key === 'ArrowLeft') setDatum((d) => verschuif(weergave, d, -1))
      else if (e.key === 'ArrowRight') setDatum((d) => verschuif(weergave, d, 1))
      else if (e.key.toLowerCase() === 't') setDatum(vandaag())
      else if (e.key.toLowerCase() === 'd') kiesModus('dag')
      else if (e.key.toLowerCase() === 'w') kiesModus('week')
      else if (e.key.toLowerCase() === 'm') kiesModus('maand')
    }
    document.addEventListener('keydown', t)
    return () => document.removeEventListener('keydown', t)
  }) // eslint-disable-line react-hooks/exhaustive-deps
  const kiesModus = (m: Modus) => { setModus(m); if (m !== 'lijst') bewaarVoorkeur({ modus: m }) }

  if (fout) return <div className="card-base text-sm text-red-700">{fout}</div>
  if (!boom) return <div className="card-base flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div>

  // Ik eerst, dan de zaakvoerders, dan de rest met een account.
  const rang = (id: string) => (id === boom.ik ? 0 : boom.zaakvoerders.includes(id) ? 1 : 2)
  const mensen = boom.personen.filter((p) => p.actief && p.user_id).sort((a, b) => rang(a.id) - rang(b.id) || a.naam.localeCompare(b.naam))
  const titelKeuze = keuze && keuze.soort !== 'doc'
    ? (keuze.soort === 'lijst' ? padVan(boom, keuze.id) : keuze.soort === 'map' ? [boom.mappen.find((m) => m.id === keuze.id)?.naam ?? 'Map'] : [boom.spaces.find((s) => s.id === keuze.id)?.naam ?? 'Space'])
    : null
  const filterTeller = (personen.length ? 1 : 0) + (labels.length ? 1 : 0) + (klant ? 1 : 0)
  const printUrl = `/api/admin/agenda/print?dag=${modus === 'dag' ? datum : vandaag()}${personen.length ? `&personen=${personen.join(',')}` : ''}${toonKlaar ? '&klaar=1' : ''}`

  return (
    <div className="flex gap-3 md:h-[calc(100dvh-3.5rem)] min-h-[620px]">
      {/* Boom: vast op de computer, als lade op de gsm */}
      {toonBoom && (
        <>
          <div className="md:hidden fixed inset-0 z-40 bg-black/30" onClick={() => setToonBoom(false)} aria-hidden />
          <aside className="fixed md:static inset-y-0 left-0 z-50 md:z-auto w-[280px] md:w-64 shrink-0 bg-white md:card-base md:!p-0 overflow-hidden flex flex-col shadow-xl md:shadow-none">
            <Boom boom={boom} keuze={keuze} onVernieuw={laadBoom} onNieuwDoc={nieuwDoc}
              onKies={(k) => { setKeuze(k); if (window.innerWidth < 768) setToonBoom(false) }} onPaneel={(p) => setPaneel(p)} />
          </aside>
        </>
      )}

      <section className="flex-1 min-w-0 flex flex-col gap-2.5 min-h-0">
        {/* Bovenbalk */}
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => { setToonBoom(!toonBoom); bewaarVoorkeur({ boom: !toonBoom }) }} aria-label={toonBoom ? 'Boom verbergen' : 'Boom tonen'} className={`h-9 w-9 rounded-lg border border-gray-200 bg-white flex items-center justify-center hover:border-gray-400 ${focusRing}`}><PanelLeft className="h-4 w-4" /></button>
          <div className="min-w-0 mr-auto">
            <h1 className="text-xl font-bold text-gray-900 truncate">{titelKeuze ? titelKeuze[titelKeuze.length - 1] : keuze?.soort === 'doc' ? 'Document' : 'Agenda'}</h1>
            {titelKeuze && titelKeuze.length > 1 && <div className="text-xs text-gray-500 truncate">{titelKeuze.slice(0, -1).join(' › ')}</div>}
          </div>
          {keuze?.soort !== 'doc' && (
            <>
              {modus !== 'lijst' && (
                <div className="flex items-center gap-1">
                  <button type="button" onClick={() => setDatum(vandaag())} className={`btn-secondary !py-1.5 !px-3 !text-sm ${focusRing}`}>Vandaag</button>
                  <button type="button" onClick={() => setDatum(verschuif(weergave, datum, -1))} aria-label="Vorige" className={`h-9 w-9 rounded-lg hover:bg-white flex items-center justify-center ${focusRing}`}><ChevronLeft className="h-4 w-4" /></button>
                  <button type="button" onClick={() => setDatum(verschuif(weergave, datum, 1))} aria-label="Volgende" className={`h-9 w-9 rounded-lg hover:bg-white flex items-center justify-center ${focusRing}`}><ChevronRight className="h-4 w-4" /></button>
                  <span className="text-sm font-semibold text-gray-900 min-w-[9rem] capitalize">{periodeTitel(weergave, datum)}</span>
                  {laden && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
                </div>
              )}
              <div className="flex rounded-lg border border-gray-200 bg-white p-0.5" role="tablist" aria-label="Weergave">
                {container && <Tab aan={modus === 'lijst'} onClick={() => kiesModus('lijst')}><ListIcon className="h-3.5 w-3.5" />Lijst</Tab>}
                <Tab aan={modus === 'dag'} onClick={() => kiesModus('dag')}>Dag</Tab>
                <Tab aan={modus === 'week'} onClick={() => kiesModus('week')}>Week</Tab>
                <Tab aan={modus === 'maand'} onClick={() => kiesModus('maand')}>Maand</Tab>
              </div>
              <a href={printUrl} target="_blank" rel="noopener noreferrer" className={`btn-secondary !py-1.5 !px-3 !text-sm ${focusRing}`} title="Takenlijst als pdf om af te drukken"><Printer className="h-4 w-4" /><span className="hidden lg:inline">{modus === 'dag' && datum !== vandaag() ? 'Takenlijst' : 'Takenlijst vandaag'}</span></a>
              {boom.rechten.toevoegen && <button type="button" onClick={() => setNieuw({ dag: modus === 'lijst' ? vandaag() : datum < vandaag() && weergave !== 'dag' ? vandaag() : datum, heelDag: true })} className={`btn-primary !py-1.5 !px-3 !text-sm ${focusRing}`}><Plus className="h-4 w-4" />Nieuw</button>}
            </>
          )}
        </div>

        {/* Filters */}
        {keuze?.soort !== 'doc' && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip aan={!personen.length} onClick={() => { setPersonen([]); bewaarVoorkeur({ personen: [] }) }}><Users className="h-3.5 w-3.5" />Iedereen</Chip>
            {mensen.slice(0, 8).map((p) => {
              const aan = personen.includes(p.id)
              return (
                <button key={p.id} type="button" onClick={() => { const n = aan ? personen.filter((x) => x !== p.id) : [...personen, p.id]; setPersonen(n); bewaarVoorkeur({ personen: n }) }} aria-pressed={aan}
                  className={`inline-flex items-center gap-1.5 rounded-full border pl-0.5 pr-2.5 py-0.5 text-xs ${aan ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'} ${focusRing}`}>
                  <PersoonFoto naam={p.naam} maat={20} />{p.naam.split(' ')[0]}{p.id === boom.ik && <span className={aan ? 'text-white/70' : 'text-gray-400'}>(ik)</span>}
                </button>
              )
            })}
            <div className="relative">
              <Chip aan={personen.some((p) => !mensen.slice(0, 8).some((m) => m.id === p))} onClick={() => setPop(pop === 'personen' ? null : 'personen')}>Iemand anders…</Chip>
              <Popover open={pop === 'personen'} onSluit={sluitPop}><PersonenLijst personen={boom.personen} ik={boom.ik} gekozen={personen} onWissel={(p) => { const n = personen.includes(p) ? personen.filter((x) => x !== p) : [...personen, p]; setPersonen(n); bewaarVoorkeur({ personen: n }) }} /></Popover>
            </div>
            <span className="w-px h-5 bg-gray-200 mx-1" />
            <div className="relative">
              <Chip aan={labels.length > 0} onClick={() => setPop(pop === 'labels' ? null : 'labels')}><Tag className="h-3.5 w-3.5" />{labels.length ? `${labels.length} label${labels.length > 1 ? 's' : ''}` : 'Labels'}</Chip>
              <Popover open={pop === 'labels'} onSluit={sluitPop}>
                <div className="w-56 p-2 max-h-72 overflow-y-auto">
                  {boom.labels.map((l) => (
                    <button key={l.id} type="button" role="checkbox" aria-checked={labels.includes(l.id)} onClick={() => setLabels(labels.includes(l.id) ? labels.filter((x) => x !== l.id) : [...labels, l.id])} className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-gray-50">
                      <span className="h-3 w-3 rounded-full" style={{ background: l.kleur }} /><span className="flex-1 text-left">{l.naam}</span>{labels.includes(l.id) && <span className="text-xs">✓</span>}
                    </button>
                  ))}
                </div>
              </Popover>
            </div>
            <div className="relative">
              <Chip aan={!!klant} onClick={() => setPop(pop === 'klant' ? null : 'klant')}><Building2 className="h-3.5 w-3.5" />{klant ? boom.klanten.find((k) => k.id === klant)?.naam ?? 'Klant' : 'Klant'}</Chip>
              <Popover open={pop === 'klant'} onSluit={sluitPop}><KlantLijst boom={boom} gekozen={klant} onKies={(k) => { setKlant(k); sluitPop() }} /></Popover>
            </div>
            <Chip aan={toonKlaar} onClick={() => { setToonKlaar(!toonKlaar); bewaarVoorkeur({ klaar: !toonKlaar }) }}>{toonKlaar ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}Afgevinkt</Chip>
            {filterTeller > 0 && <button type="button" onClick={() => { setPersonen([]); setLabels([]); setKlant(null); bewaarVoorkeur({ personen: [] }) }} className="text-xs text-gray-500 hover:underline inline-flex items-center gap-0.5"><X className="h-3 w-3" />Wis filters</button>}
            <span className="flex-1" />
            <label className="text-xs text-gray-500 flex items-center gap-1.5">Kleur volgens
              <select value={kleurVolgens} onChange={(e) => { setKleurVolgens(e.target.value as KleurVolgens); bewaarVoorkeur({ kleur: e.target.value as KleurVolgens }) }} className="input-base !py-1 !px-2 !text-xs w-auto">
                {KLEUR_VOLGENS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
              </select>
            </label>
            <Zoeken boom={boom} open={pop === 'zoek'} onOpen={() => setPop('zoek')} onSluit={sluitPop} onKies={(i) => { sluitPop(); open(i) }} />
          </div>
        )}

        {boom.isAdmin && boom.mailVoorstellen > 0 && keuze?.soort !== 'doc' && (
          <button type="button" onClick={() => setPaneel('mail')} className={`flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-left hover:border-gray-400 ${focusRing}`}>
            <Mail className="h-4 w-4" /><span className="flex-1"><strong>{boom.mailVoorstellen} uitnodiging{boom.mailVoorstellen > 1 ? 'en' : ''}</strong> uit de mail om in te plannen</span><ChevronRight className="h-4 w-4 text-gray-400" />
          </button>
        )}

        {/* Inhoud */}
        <div className="flex-1 min-h-0">
          {keuze?.soort === 'doc' ? (
            <DocWeergave key={keuze.id} id={keuze.id} boom={boom} onVernieuw={laadBoom} onVerwijderd={() => { setKeuze(null); laadBoom() }} />
          ) : modus === 'lijst' && lijstenVanKeuze ? (
            <div className="h-full overflow-y-auto pb-6">
              <LijstWeergave lijstIds={lijstenVanKeuze} items={lijstItems ? filter(lijstItems, true) : null}
                boom={boom} personen={personenMap} laden magToevoegen={!!boom.rechten.toevoegen}
                onOpen={open} onKlaar={wisselKlaar} onToegevoegd={laadLijst} onDoc={(id) => setKeuze({ soort: 'doc', id })} />
            </div>
          ) : (
            <Kalender weergave={weergave} datum={datum} items={zichtbaar} kleur={kleur} personen={personenMap}
              magAanpassen={!!boom.rechten.aanpassen} magToevoegen={!!boom.rechten.toevoegen}
              onOpen={open} onKlaar={wisselKlaar} onVerplaats={verplaats} onNieuw={setNieuw}
              onDag={(d) => { setDatum(d); kiesModus('dag') }} />
          )}
        </div>
      </section>

      {/* Vensters */}
      {openItem && (
        <ItemVenster key={openItem} id={openItem} boom={boom} onSluit={() => setOpenItem(null)} onOpen={(id) => setOpenItem(id)}
          onGewijzigd={() => { if (modus === 'lijst') laadLijst(); else laadItems() }}
          onVerwijderd={(id) => { setOpenItem(null); setItems((l) => l?.filter((x) => x.id !== id) ?? null); setLijstItems((l) => l?.filter((x) => x.id !== id) ?? null) }} />
      )}
      {nieuw && (
        <NieuwVenster m={nieuw} boom={boom} standaardLijst={keuze?.soort === 'lijst' ? keuze.id : null} magMeeting={boom.meetings}
          onSluit={() => setNieuw(null)}
          onTaak={(id) => { setNieuw(null); vernieuw(); setOpenItem(id) }}
          onMeeting={(wat) => { laadOpties(); setMv({ soort: 'plan', wat, m: nieuw }); setNieuw(null) }} />
      )}
      {mv && !opties && <Modal titel="Meeting Inplanner" onSluit={() => setMv(null)}><div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div></Modal>}
      {mv?.soort === 'plan' && opties && (
        <PlanVenster opties={opties} bestaand={null} soort={mv.wat} controleerVrij
          voorinvul={{ dag: mv.m.dag, uur: hhmm(mv.m.vanMin ?? 600), duur: Math.max(15, (mv.m.totMin ?? (mv.m.vanMin ?? 600) + 60) - (mv.m.vanMin ?? 600)) }}
          onSluit={() => setMv(null)} onOpen={(id) => setMv({ soort: 'detail', id })}
          onKlaar={(m, melding) => { if (melding) toast.success(melding); laadItems(); setMv({ soort: 'detail', id: m.id }) }} />
      )}
      {mv?.soort === 'detail' && opties && (
        <DetailVenster id={mv.id} opties={opties} onSluit={() => setMv(null)} onVeranderd={laadItems}
          onWijzig={(m) => setMv({ soort: 'wijzig', meeting: m })} onAnnuleer={(m) => setMv({ soort: 'annuleer', meeting: m })} />
      )}
      {mv?.soort === 'wijzig' && opties && (
        <PlanVenster opties={opties} bestaand={mv.meeting} controleerVrij onSluit={() => setMv({ soort: 'detail', id: mv.meeting.id })}
          onOpen={(id) => setMv({ soort: 'detail', id })} onKlaar={(m, melding) => { if (melding) toast.success(melding); laadItems(); setMv({ soort: 'detail', id: m.id }) }} />
      )}
      {mv?.soort === 'annuleer' && (
        <AnnuleerVenster m={mv.meeting} onSluit={() => setMv({ soort: 'detail', id: mv.meeting.id })} onKlaar={(m) => { toast.success('Meeting geannuleerd.'); laadItems(); setMv({ soort: 'detail', id: m.id }) }} />
      )}
      {paneel === 'klaar' && <AfgevinktPaneel boom={boom} onSluit={() => setPaneel(null)} onOpen={(i) => setOpenItem(i.id)} onVernieuw={vernieuw} />}
      {paneel === 'prullenbak' && <PrullenbakPaneel boom={boom} onSluit={() => setPaneel(null)} onVernieuw={vernieuw} />}
      {paneel === 'mail' && <MailPaneel boom={boom} onSluit={() => setPaneel(null)} onVernieuw={vernieuw} onOpenItem={(id) => { setPaneel(null); setOpenItem(id) }} />}
      {paneel === 'instellingen' && <InstellingenPaneel boom={boom} onSluit={() => setPaneel(null)} onVernieuw={vernieuw} />}
    </div>
  )
}

function Tab({ aan, onClick, children }: { aan: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" role="tab" aria-selected={aan} onClick={onClick} className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm ${aan ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100'} ${focusRing}`}>{children}</button>
}
function Chip({ aan, onClick, children }: { aan: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} aria-pressed={aan} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${aan ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'} ${focusRing}`}>{children}</button>
}

/** Zoeken in alle taken en afspraken (titel). */
function Zoeken({ boom, open, onOpen, onSluit, onKies }: { boom: BoomData; open: boolean; onOpen: () => void; onSluit: () => void; onKies: (i: Item) => void }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState<Item[] | null>(null)
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return }
    const t = setTimeout(() => { api<{ items: Item[] }>(`/api/admin/agenda?zoek=${encodeURIComponent(q.trim())}`).then((j) => setRes(j.items)).catch(() => setRes([])) }, 250)
    return () => clearTimeout(t)
  }, [q])
  return (
    <div className="relative">
      <Chip aan={open} onClick={open ? onSluit : onOpen}><Search className="h-3.5 w-3.5" />Zoeken</Chip>
      <Popover open={open} onSluit={onSluit} uitlijnen="rechts">
        <div className="w-80 p-2">
          <input {...zoekVeld()} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek een taak of afspraak…" className="input-base !py-1.5 text-sm" aria-label="Zoek een taak of afspraak" />
          <ul className="max-h-80 overflow-y-auto mt-1.5">
            {res?.map((i) => (
              <li key={i.id}><button type="button" onClick={() => onKies(i)} className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-gray-50">
                <div className={`text-sm truncate ${i.status === 'klaar' ? 'line-through text-gray-400' : ''}`}>{i.titel}</div>
                <div className="text-[11px] text-gray-500 truncate">{wanneer(i)}{i.lijst_id ? ` · ${padVan(boom, i.lijst_id).slice(-2).join(' › ')}` : ''}</div>
              </button></li>
            ))}
            {res && !res.length && <li className="px-2 py-3 text-xs text-gray-500">Niets gevonden.</li>}
          </ul>
        </div>
      </Popover>
    </div>
  )
}

