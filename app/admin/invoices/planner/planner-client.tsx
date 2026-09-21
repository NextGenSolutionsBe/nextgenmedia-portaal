'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, CalendarDays, CalendarRange, List, Loader2, X, ArrowUpDown, Send, Eye, AlertTriangle, Clock, Wallet, FileWarning, CalendarCheck, Filter } from 'lucide-react'
import {
  vandaagBrussel, isDatum, ymVan, plusDagen, maandStart, maandEind, maandRooster, roosterBereik, weekBereik, shiftYM,
  maandNaam, datumKort, datumLang, DAGEN_KORT, euro, euro2, kort, samenvatting, pasFiltersToe, dagTotalen, sorteer, filtersActief,
  LEEG_FILTERS, PLANNER_STATUSSEN, STATUS_INFO, HERKOMST_LABEL,
  type Moment, type Filters, type Categorie, type Sortering,
} from '@/lib/facturatie/planner-model'
import { PlannerDetail, DagPaneel, StatusBadge, type Actie } from './planner-detail'
import { FactuurEditor } from '../factuur-editor'
import { Plus } from 'lucide-react'

type Data = { momenten: Moment[]; klanten: { id: string; company_name: string }[]; vandaag: string; verantwoordelijke: string }
type Weergave = 'maand' | 'week' | 'lijst'
const WEERGAVEN: Weergave[] = ['maand', 'week', 'lijst']
const CATEGORIEEN: Categorie[] = ['vandaag', 'week', 'maand', 'achterstallig', 'ontbrekend']
const MAX_DAGEN = 400
const sel = 'rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs'

export function PlannerClient({ startCategorie, startWeergave, startDatum }: { startCategorie: string | null; startWeergave: string | null; startDatum: string | null }) {
  const [vandaag] = useState(() => vandaagBrussel())
  const [weergave, setWeergave] = useState<Weergave>(WEERGAVEN.includes(startWeergave as Weergave) ? (startWeergave as Weergave) : 'maand')
  const [anker, setAnker] = useState<string>(isDatum(startDatum) ? startDatum : vandaag)
  const [filters, setFilters] = useState<Filters>({ ...LEEG_FILTERS, categorie: CATEGORIEEN.includes(startCategorie as Categorie) ? (startCategorie as Categorie) : null })
  const [sortering, setSortering] = useState<Sortering>({ veld: 'datum', richting: 'asc' })
  const [data, setData] = useState<Data | null>(null)
  const [laden, setLaden] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [geselecteerd, setGeselecteerd] = useState<string | null>(null)
  const [dag, setDag] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const [toonFilters, setToonFilters] = useState(false)
  // Factuureditor: bestaande factuur openen, of een nieuwe op een gekozen dag.
  const [editor, setEditor] = useState<{ invoiceId: string } | { datum: string } | null>(null)
  const cache = useRef(new Map<string, Data>())
  const onderweg = useRef(new Map<string, Promise<Data>>())
  const [versie, setVersie] = useState(0)

  // ── Welke periode laden? Zichtbare kalender ∪ dashboardvenster ∪ periodefilter ──
  const ym = ymVan(anker)
  const zicht = weergave === 'week' ? weekBereik(anker) : roosterBereik(ym)
  const bereik = useMemo(() => {
    const kandidatenVan = [zicht.van, plusDagen(vandaag, -120), filters.van || zicht.van]
    const kandidatenTot = [zicht.tot, maandEind(shiftYM(ymVan(vandaag), 1)), filters.tot || zicht.tot]
    let van = kandidatenVan.sort()[0], tot = kandidatenTot.sort().slice(-1)[0]
    if ((Date.parse(tot) - Date.parse(van)) / 86_400_000 > MAX_DAGEN) van = plusDagen(tot, -MAX_DAGEN)
    return { van, tot }
  }, [zicht.van, zicht.tot, vandaag, filters.van, filters.tot])
  const sleutel = `${bereik.van}|${bereik.tot}`

  const laad = useCallback(async (key: string, van: string, tot: string) => {
    const bekend = cache.current.get(key)
    if (bekend) { setData(bekend); return }
    setLaden(true); setFout(null)
    try {
      let p = onderweg.current.get(key)
      if (!p) {
        p = fetch(`/api/admin/invoices/planner?van=${van}&tot=${tot}`, { cache: 'no-store' }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Laden mislukt'); return j as Data })
        onderweg.current.set(key, p)
      }
      const d = await p
      cache.current.set(key, d); setData(d)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
    finally { onderweg.current.delete(key); setLaden(false) }
  }, [])
  useEffect(() => { laad(sleutel, bereik.van, bereik.tot) }, [sleutel, bereik.van, bereik.tot, laad, versie])
  const ververs = () => { cache.current.clear(); setVersie((v) => v + 1) }

  // ── Afgeleide gegevens: één bron voor dashboard, kalender en lijst ──
  const alle = useMemo(() => data?.momenten ?? [], [data])
  const basis = useMemo(() => pasFiltersToe(alle, { ...filters, categorie: null }, vandaag), [alle, filters, vandaag])
  const sam = useMemo(() => samenvatting(basis, vandaag), [basis, vandaag])
  const zichtbaar = useMemo(() => pasFiltersToe(basis, { ...LEEG_FILTERS, categorie: filters.categorie, toonGeannuleerd: filters.toonGeannuleerd, status: filters.status }, vandaag), [basis, filters.categorie, filters.toonGeannuleerd, filters.status, vandaag])
  const perDag = useMemo(() => { const m = new Map<string, Moment[]>(); for (const x of zichtbaar) { const l = m.get(x.datum) ?? []; l.push(x); m.set(x.datum, l) } return m }, [zichtbaar])
  const totalen = useMemo(() => dagTotalen(zichtbaar), [zichtbaar])
  const lijstBereik = filters.categorie || filters.van || filters.tot ? { van: filters.van || bereik.van, tot: filters.tot || bereik.tot } : weergave === 'week' ? zicht : { van: maandStart(ym), tot: maandEind(ym) }
  const lijst = useMemo(() => sorteer(zichtbaar.filter((m) => m.datum >= lijstBereik.van && m.datum <= lijstBereik.tot), sortering), [zichtbaar, lijstBereik.van, lijstBereik.tot, sortering])
  const lijstTotaal = lijst.filter((m) => m.status !== 'geannuleerd').reduce((s, m) => s + m.bedrag_excl, 0)
  const geselecteerdMoment = geselecteerd ? alle.find((m) => m.id === geselecteerd) ?? null : null
  const typen = useMemo(() => [...new Set(alle.map((m) => m.type))].sort(), [alle])
  const verantwoordelijken = useMemo(() => [...new Set(alle.map((m) => m.verantwoordelijke).filter((v): v is string => !!v))].sort(), [alle])

  // ── Acties ──
  const voerUit = useCallback(async (actie: Actie, m: Moment, extra?: { datum?: string }): Promise<boolean> => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/invoices/planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie, id: m.id, datum: extra?.datum }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Actie mislukt')
      for (const w of (j.waarschuwingen ?? []) as string[]) toast.warning(w)
      toast.success({ verstuurd: 'Gemarkeerd als verstuurd.', verplaats: `Facturatiedatum verplaatst naar ${extra?.datum ? datumLang(extra.datum) : ''}.`, annuleer: 'Facturatieopdracht geannuleerd.' }[actie])
      ververs()
      return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Actie mislukt'); return false }
    finally { setBezig(false) }
  }, [])

  // ── Slepen: een te versturen factuur naar een andere dag ──
  const [sleepDoel, setSleepDoel] = useState<string | null>(null)
  const sleepStart = (e: React.DragEvent, m: Moment) => {
    if (!m.acties.kanVerplaatsen) { e.preventDefault(); return }
    e.dataTransfer.setData('text/plain', m.id); e.dataTransfer.effectAllowed = 'move'
  }
  const sleepOver = (e: React.DragEvent, d: string) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (sleepDoel !== d) setSleepDoel(d) }
  const laatVallen = async (e: React.DragEvent, d: string) => {
    e.preventDefault(); setSleepDoel(null)
    const id = e.dataTransfer.getData('text/plain')
    const m = alle.find((x) => x.id === id)
    if (!m || !m.acties.kanVerplaatsen || m.datum === d) return
    await voerUit('verplaats', m, { datum: d })
  }
  const sleepbaar = (m: Moment) => m.acties.kanVerplaatsen && m.status !== 'geannuleerd'

  const ga = (richting: -1 | 1) => setAnker((a) => (weergave === 'week' ? plusDagen(a, 7 * richting) : `${shiftYM(ymVan(a), richting)}-01`))
  const zetCategorie = (c: Categorie) => { setFilters((f) => ({ ...f, categorie: f.categorie === c ? null : c })); if (filters.categorie !== c) setWeergave('lijst') }
  const zet = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }))
  const sorteerOp = (veld: Sortering['veld']) => setSortering((s) => ({ veld, richting: s.veld === veld && s.richting === 'asc' ? 'desc' : 'asc' }))

  const titel = weergave === 'week' ? `Week van ${datumLang(zicht.van)} t/m ${datumKort(zicht.tot)}` : maandNaam(ym)

  return (
    <div className="space-y-4">
      {/* ── Samenvatting ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
        <Kaart actief={filters.categorie === 'vandaag'} onClick={() => zetCategorie('vandaag')} icon={CalendarCheck} label="Te versturen vandaag" waarde={String(sam.vandaag)} kleur={sam.vandaag > 0 ? 'text-yellow-700' : 'text-gray-900'} />
        <Kaart actief={filters.categorie === 'week'} onClick={() => zetCategorie('week')} icon={Clock} label="Te versturen deze week" waarde={String(sam.week)} />
        <Kaart actief={filters.categorie === 'maand'} onClick={() => zetCategorie('maand')} icon={CalendarDays} label="Te versturen deze maand" waarde={String(sam.maand)} />
        <Kaart actief={filters.categorie === 'maand'} onClick={() => zetCategorie('maand')} icon={Wallet} label="Te factureren deze maand" waarde={euro(sam.maandBedrag)} sub={`excl. btw · ${euro(sam.maandBedragTotaal)} incl. verstuurd`} />
        <Kaart actief={filters.categorie === 'achterstallig'} onClick={() => zetCategorie('achterstallig')} icon={AlertTriangle} label="Achterstallig" waarde={String(sam.achterstallig)} kleur={sam.achterstallig > 0 ? 'text-red-600' : 'text-green-600'} />
        <Kaart actief={filters.categorie === 'ontbrekend'} onClick={() => zetCategorie('ontbrekend')} icon={FileWarning} label="Ontbrekende gegevens" waarde={String(sam.ontbrekend)} kleur={sam.ontbrekend > 0 ? 'text-orange-600' : 'text-green-600'} />
      </div>

      {/* ── Werkbalk ── */}
      <div className="card-base p-3 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => ga(-1)} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50" aria-label="Vorige periode"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => setAnker(vandaag)} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">Vandaag</button>
            <button type="button" onClick={() => ga(1)} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50" aria-label="Volgende periode"><ChevronRight className="h-4 w-4" /></button>
            <span className="text-sm font-semibold capitalize ml-1">{titel}</span>
            {laden && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              {([['maand', CalendarDays, 'Maand'], ['week', CalendarRange, 'Week'], ['lijst', List, 'Lijst']] as const).map(([w, Icon, label]) => (
                <button key={w} type="button" onClick={() => setWeergave(w)} className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${weergave === w ? 'bg-black text-white' : 'text-gray-600 hover:bg-white'}`}><Icon className="h-3.5 w-3.5" />{label}</button>
              ))}
            </div>
            <button type="button" onClick={() => setToonFilters((v) => !v)} className={`btn-secondary text-xs ${toonFilters || filtersActief(filters) ? 'ring-1 ring-black' : ''}`}><Filter className="h-3.5 w-3.5" />Filters{filtersActief(filters) ? ' •' : ''}</button>
            {filtersActief(filters) && <button type="button" onClick={() => setFilters(LEEG_FILTERS)} className="btn-secondary text-xs"><X className="h-3.5 w-3.5" />Filters wissen</button>}
            <button type="button" onClick={() => setEditor({ datum: vandaag })} className="btn-primary text-xs"><Plus className="h-3.5 w-3.5" />Nieuwe factuur</button>
          </div>
        </div>

        {filters.categorie && (
          <div className="flex items-center gap-2 text-xs text-gray-700 bg-[#fff848]/30 border border-yellow-200 rounded-lg px-3 py-1.5 w-fit">
            Gefilterd op: <b>{{ vandaag: 'te versturen vandaag', week: 'te versturen deze week', maand: 'deze maand', achterstallig: 'achterstallig', ontbrekend: 'ontbrekende gegevens' }[filters.categorie]}</b>
            <button type="button" onClick={() => zet('categorie', null)} className="ml-1 rounded p-0.5 hover:bg-yellow-200" aria-label="Categoriefilter wissen"><X className="h-3 w-3" /></button>
          </div>
        )}

        {toonFilters && (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-2 pt-2 border-t border-gray-100">
            <div className="flex items-center gap-1 col-span-2"><input type="date" className={`${sel} flex-1`} value={filters.van} onChange={(e) => zet('van', e.target.value)} aria-label="Periode van" /><span className="text-xs text-gray-400">–</span><input type="date" className={`${sel} flex-1`} value={filters.tot} onChange={(e) => zet('tot', e.target.value)} aria-label="Periode tot" /></div>
            <select className={sel} value={filters.klant} onChange={(e) => zet('klant', e.target.value)}><option value="">Alle klanten</option>{(data?.klanten ?? []).map((k) => <option key={k.id} value={k.id}>{k.company_name}</option>)}</select>
            <input className={sel} placeholder="Project of omschrijving…" value={filters.project} onChange={(e) => zet('project', e.target.value)} />
            <select className={sel} value={filters.status} onChange={(e) => zet('status', e.target.value as Filters['status'])}><option value="">Alle statussen</option>{PLANNER_STATUSSEN.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            <select className={sel} value={filters.type} onChange={(e) => zet('type', e.target.value)}><option value="">Alle factuurtypes</option>{typen.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <select className={sel} value={filters.terugkerend} onChange={(e) => zet('terugkerend', e.target.value as Filters['terugkerend'])}><option value="">Eenmalig en terugkerend</option><option value="eenmalig">Eenmalig</option><option value="terugkerend">Terugkerend</option></select>
            <select className={sel} value={filters.verantwoordelijke} onChange={(e) => zet('verantwoordelijke', e.target.value)}><option value="">Alle verantwoordelijken</option>{verantwoordelijken.map((v) => <option key={v} value={v}>{v}</option>)}</select>
            <select className={sel} value={filters.volledig} onChange={(e) => zet('volledig', e.target.value as Filters['volledig'])}><option value="">Volledig en onvolledig</option><option value="volledig">Volledige gegevens</option><option value="ontbrekend">Ontbrekende gegevens</option></select>
            <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={filters.toonGeannuleerd} onChange={(e) => zet('toonGeannuleerd', e.target.checked)} />Toon geannuleerd (geschiedenis)</label>
          </div>
        )}
      </div>

      {fout && <div className="card-base text-sm text-red-700 bg-red-50 border-red-100">Planner laden mislukt: {fout}</div>}

      {/* ── Kalender / lijst ── */}
      {weergave === 'maand' && (
        <div className="card-base p-0 overflow-hidden">
          <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50 text-[11px] font-medium text-gray-500 uppercase tracking-wide">{DAGEN_KORT.map((d) => <div key={d} className="px-2 py-1.5 text-center">{d}</div>)}</div>
          <div className="grid grid-cols-7 grid-rows-6">
            {maandRooster(ym).flat().map((d) => {
              const items = perDag.get(d) ?? []
              const t = totalen.get(d)
              const inMaand = ymVan(d) === ym
              const isVandaag = d === vandaag
              const toon = items.slice(0, 3), meer = items.length - toon.length
              return (
                <div key={d} onDragOver={(e) => sleepOver(e, d)} onDragLeave={() => setSleepDoel((x) => (x === d ? null : x))} onDrop={(e) => laatVallen(e, d)}
                  className={`min-h-[64px] sm:min-h-[112px] border-b border-r border-gray-100 p-1 sm:p-1.5 flex flex-col transition-colors ${inMaand ? 'bg-white' : 'bg-gray-50/60'} ${isVandaag ? 'ring-2 ring-inset ring-[#fff848]' : ''} ${sleepDoel === d ? 'bg-[#fff848]/30 ring-2 ring-inset ring-black' : ''}`}>
                  <button type="button" onClick={() => setDag(d)} className="flex items-start justify-between gap-1 text-left w-full">
                    <span className={`text-xs font-medium h-5 min-w-5 px-1 inline-flex items-center justify-center rounded-full ${isVandaag ? 'bg-[#fff848] text-black' : inMaand ? 'text-gray-800' : 'text-gray-400'}`}>{Number(d.slice(8, 10))}</span>
                    {t && <span className="text-[10px] text-gray-500 text-right leading-tight"><b className="text-gray-800">{t.aantal}</b><span className="hidden sm:inline"> · {euro(t.bedrag)}</span></span>}
                  </button>
                  <div className="hidden sm:flex flex-col gap-0.5 mt-1">
                    {toon.map((m) => (
                      <button key={m.id} type="button" onClick={() => setGeselecteerd(m.id)} title={`${kort(m)} · ${STATUS_INFO[m.status].label}${sleepbaar(m) ? ' · sleep naar een andere dag om te verplaatsen' : ''}`}
                        draggable={sleepbaar(m)} onDragStart={(e) => sleepStart(e, m)}
                        className={`text-left text-[10.5px] leading-tight px-1.5 py-0.5 rounded border-l-2 truncate ${STATUS_INFO[m.status].cls} ${m.status === 'geannuleerd' ? 'line-through' : ''} ${sleepbaar(m) ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                        {kort(m)}
                      </button>
                    ))}
                    {meer > 0 && <button type="button" onClick={() => setDag(d)} className="text-[10.5px] text-gray-500 hover:text-black text-left px-1.5">+{meer} meer</button>}
                  </div>
                  {items.length > 0 && <button type="button" onClick={() => setDag(d)} className="sm:hidden mt-auto flex gap-0.5 flex-wrap">{items.slice(0, 6).map((m) => <span key={m.id} className={`h-1.5 w-1.5 rounded-full ${STATUS_INFO[m.status].stip}`} />)}</button>}
                </div>
              )
            })}
          </div>
          <p className="px-3 pt-2 text-[11px] text-gray-500 hidden sm:block">Sleep een factuur naar een andere dag om de facturatiedatum te verplaatsen; de datum wijzigt meteen in Facturen en op het contract. Geannuleerde of gecrediteerde facturen verplaats je niet.</p>
          <Legenda />
        </div>
      )}

      {weergave === 'week' && (
        <div className="card-base p-0 overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-7 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
            {Array.from({ length: 7 }, (_, i) => plusDagen(zicht.van, i)).map((d) => {
              const items = perDag.get(d) ?? []
              const t = totalen.get(d)
              const isVandaag = d === vandaag
              return (
                <div key={d} onDragOver={(e) => sleepOver(e, d)} onDragLeave={() => setSleepDoel((x) => (x === d ? null : x))} onDrop={(e) => laatVallen(e, d)}
                  className={`min-h-[120px] sm:min-h-[260px] p-2 transition-colors ${isVandaag ? 'bg-[#fff848]/10' : ''} ${sleepDoel === d ? 'bg-[#fff848]/30 ring-2 ring-inset ring-black' : ''}`}>
                  <button type="button" onClick={() => setDag(d)} className="w-full text-left flex items-center justify-between gap-2 mb-2">
                    <span className={`text-xs font-semibold capitalize ${isVandaag ? 'bg-[#fff848] rounded-full px-2 py-0.5' : 'text-gray-700'}`}>{DAGEN_KORT[i(d)]} {Number(d.slice(8, 10))}</span>
                    {t && <span className="text-[10px] text-gray-500">{t.aantal} · {euro(t.bedrag)}</span>}
                  </button>
                  <div className="space-y-1">
                    {items.map((m) => (
                      <button key={m.id} type="button" onClick={() => setGeselecteerd(m.id)} draggable={sleepbaar(m)} onDragStart={(e) => sleepStart(e, m)} title={sleepbaar(m) ? 'Sleep naar een andere dag om de facturatiedatum te verplaatsen' : undefined}
                        className={`w-full text-left rounded-lg border px-2 py-1.5 ${STATUS_INFO[m.status].cls} ${m.status === 'geannuleerd' ? 'line-through opacity-70' : ''} ${sleepbaar(m) ? 'cursor-grab active:cursor-grabbing' : ''}`}>
                        <div className="text-xs font-medium truncate">{m.klant}</div>
                        <div className="text-[10.5px] truncate">{euro(m.bedrag_excl)} · {m.type}</div>
                        {m.contract_titel && <div className="text-[10px] truncate opacity-70">📄 {m.contract_titel}</div>}
                      </button>
                    ))}
                    {items.length === 0 && <div className="text-[11px] text-gray-300">—</div>}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="px-3 pt-2 text-[11px] text-gray-500 hidden sm:block">Sleep een factuur naar een andere dag om de facturatiedatum te verplaatsen; de datum wijzigt meteen in Facturen en op het contract. Geannuleerde of gecrediteerde facturen verplaats je niet.</p>
          <Legenda />
        </div>
      )}

      {weergave === 'lijst' && (
        <div className="card-base p-0 overflow-hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-gray-100 text-xs text-gray-500 flex-wrap">
            <span>{lijst.length} facturatiemoment{lijst.length === 1 ? '' : 'en'} · {datumNlKort(lijstBereik.van)} – {datumNlKort(lijstBereik.tot)}</span>
            <span>Totaal excl. btw: <b className="text-gray-900">{euro2(lijstTotaal)}</b></span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[1080px]">
              <thead>
                <tr className="text-left text-[11px] text-gray-500 uppercase tracking-wide bg-gray-50">
                  <Kop veld="datum" sortering={sortering} onClick={sorteerOp}>Facturatiedatum</Kop>
                  <Kop veld="klant" sortering={sortering} onClick={sorteerOp}>Klant</Kop>
                  <th className="px-3 py-2 font-medium">Project</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <Kop veld="bedrag" sortering={sortering} onClick={sorteerOp} rechts>Excl. btw</Kop>
                  <th className="px-3 py-2 font-medium text-right">Btw</th>
                  <th className="px-3 py-2 font-medium text-right">Incl. btw</th>
                  <Kop veld="status" sortering={sortering} onClick={sorteerOp}>Status</Kop>
                  <th className="px-3 py-2 font-medium">Herkomst</th>
                  <th className="px-3 py-2 font-medium">Verantw.</th>
                  <th className="px-3 py-2 font-medium text-right">Acties</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lijst.length === 0 && <tr><td colSpan={11} className="px-3 py-8 text-center text-gray-400">Geen facturatiemomenten voor deze selectie.</td></tr>}
                {lijst.map((m) => (
                  <tr key={m.id} onClick={() => setGeselecteerd(m.id)} className={`hover:bg-gray-50 cursor-pointer ${m.status === 'geannuleerd' ? 'opacity-60' : ''}`}>
                    <td className="px-3 py-2 whitespace-nowrap">{datumNlKort(m.datum)}</td>
                    <td className="px-3 py-2 font-medium">{m.klant}{!m.volledig && <AlertTriangle className="h-3 w-3 text-orange-500 inline ml-1 -mt-0.5" />}</td>
                    <td className="px-3 py-2 text-gray-600 max-w-[220px] truncate">{m.project ?? m.omschrijving ?? '—'}</td>
                    <td className="px-3 py-2 text-gray-600">{m.type}</td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums">{euro2(m.bedrag_excl)}</td>
                    <td className="px-3 py-2 text-right text-gray-500 tabular-nums">{m.btw_pct.toLocaleString('nl-BE')} %</td>
                    <td className="px-3 py-2 text-right tabular-nums">{euro2(m.bedrag_incl)}</td>
                    <td className="px-3 py-2"><StatusBadge status={m.status} /></td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{HERKOMST_LABEL[m.herkomst]}</td>
                    <td className="px-3 py-2 text-gray-600 text-xs">{m.verantwoordelijke ?? '—'}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      {m.acties.kanVerstuurd && <button type="button" disabled={bezig} onClick={() => voerUit('verstuurd', m)} className="btn-primary text-xs h-7 px-2" title="Markeren als verstuurd"><Send className="h-3 w-3" /></button>}
                      {m.invoice_id && m.bron === 'invoice' ? <button type="button" onClick={() => setEditor({ invoiceId: m.invoice_id! })} className="btn-secondary text-xs h-7 px-2 ml-1" title="Factuur openen"><Eye className="h-3 w-3" /></button>
                        : m.acties.bekijkenUrl && <Link href={m.acties.bekijkenUrl} prefetch={false} className="btn-secondary text-xs h-7 px-2 ml-1" title="Bekijken"><Eye className="h-3 w-3" /></Link>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dag && <DagPaneel datum={dag} momenten={perDag.get(dag) ?? []} onSluit={() => setDag(null)} onKies={(m) => { setDag(null); setGeselecteerd(m.id) }} onNieuw={(d) => { setDag(null); setEditor({ datum: d }) }} />}
      {geselecteerdMoment && <PlannerDetail moment={geselecteerdMoment} onSluit={() => setGeselecteerd(null)} onActie={voerUit} bezig={bezig} onOpenFactuur={(id) => setEditor({ invoiceId: id })} />}
      {editor && <FactuurEditor invoiceId={'invoiceId' in editor ? editor.invoiceId : null} standaard={'datum' in editor ? { invoice_date: editor.datum } : undefined} onClose={() => setEditor(null)} onSaved={() => ververs()} />}
    </div>
  )
}

const i = (d: string) => (new Date(Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)))).getUTCDay() + 6) % 7
const datumNlKort = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

function Kaart({ icon: Icon, label, waarde, sub, kleur, actief, onClick }: { icon: typeof CalendarDays; label: string; waarde: string; sub?: string; kleur?: string; actief: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`card-base text-left p-3 transition-shadow hover:shadow-md ${actief ? 'ring-2 ring-[#fff848]' : ''}`}>
      <div className="flex items-center justify-between gap-2 text-[11px] text-gray-500"><span className="truncate">{label}</span><Icon className="h-3.5 w-3.5 shrink-0" /></div>
      <div className={`text-xl font-bold mt-1 ${kleur ?? 'text-gray-900'}`}>{waarde}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5 truncate">{sub}</div>}
    </button>
  )
}

function Kop({ veld, sortering, onClick, children, rechts }: { veld: Sortering['veld']; sortering: Sortering; onClick: (v: Sortering['veld']) => void; children: React.ReactNode; rechts?: boolean }) {
  const actief = sortering.veld === veld
  return (
    <th className={`px-3 py-2 font-medium ${rechts ? 'text-right' : ''}`}>
      <button type="button" onClick={() => onClick(veld)} className={`inline-flex items-center gap-1 uppercase tracking-wide ${actief ? 'text-black' : ''}`}>{children}<ArrowUpDown className={`h-3 w-3 ${actief ? '' : 'opacity-40'}`} />{actief && <span className="text-[9px]">{sortering.richting === 'asc' ? '▲' : '▼'}</span>}</button>
    </th>
  )
}

function Legenda() {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 border-t border-gray-100 text-[10.5px] text-gray-500">
      {PLANNER_STATUSSEN.filter((s) => s.key !== 'geannuleerd').map((s) => <span key={s.key} className="inline-flex items-center gap-1"><span className={`h-2 w-2 rounded-full ${s.stip}`} />{s.label}</span>)}
      <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-400" />Geannuleerd (enkel met filter)</span>
    </div>
  )
}
