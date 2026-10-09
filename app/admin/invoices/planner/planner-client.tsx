'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, CalendarDays, CalendarRange, List, Loader2, X, ArrowUpDown, Eye, AlertTriangle, Filter, Search, StickyNote, Plus, Play, ChevronDown, Wallet, Send, CheckCircle2, Repeat, Trash2, Target } from 'lucide-react'
import {
  vandaagBrussel, isDatum, ymVan, plusDagen, maandStart, maandEind, maandRooster, roosterBereik, weekBereik, shiftYM,
  maandNaam, datumKort, DAGEN_KORT, euro, euro2, kort, pasFiltersToe, dagTotalen, sorteer, filtersActief,
  LEEG_FILTERS, PLANNER_STATUSSEN, STATUS_INFO, isMaandloos, FASEN, FASE_INFO, faseKpi, resultaat, maandKpi,
  TABS, tabVan, inTab, sorteerWerklijst, tabTellingen, rondeItems, maandOverzicht, omzetMeter, MAAND_DOEL,
  type Moment, type Filters, type Sortering, type Tab,
} from '@/lib/facturatie/planner-model'
import { PlannerDetail, DagPaneel, StatusBadge, type Actie } from './planner-detail'
import { FactuurEditor } from '../factuur-editor'
import { FacturatieItemWizard } from '../item-wizard'
import { ItemDetail } from '../item-detail'
import { Facturatieronde } from '../facturatieronde'
import { VerwijderDialoog, type VerwijderBereik } from '../verwijder-dialoog'
import { ExportKnop } from '@/components/admin/export-knop'
import { facturenWerkmap, type FactuurExportRij } from '@/lib/excel/rapporten/facturen'

/**
 * Facturen = interne facturatieplanner en communicatietool. Het team geeft aan
 * wat er gefactureerd moet worden; Bram neemt het ’s avonds factuur per factuur
 * over in het externe systeem en markeert het als gefactureerd.
 *
 * Daarom opent dit scherm op “Te factureren” (achterstallig bovenaan), met
 * bovenaan enkel aantal + totaal. Kosten, winst, marges en betalingen staan in
 * een secundair blok; de kalender blijft beschikbaar als tweede weergave.
 */

type Data = { momenten: Moment[]; klanten: { id: string; company_name: string }[]; vandaag: string; verantwoordelijke: string }
type Weergave = 'maand' | 'week' | 'lijst'
const MAX_DAGEN = 1200
const sel = 'rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs'
type WizardStaat = { invoiceId: string } | { recurringMaand: { recurring_id: string; maand: string; momentId: string } } | { datum: string } | null

export function PlannerClient({ startWeergave, startDatum, startFactuur = null }: { startCategorie?: string | null; startWeergave: string | null; startDatum: string | null; startFactuur?: string | null }) {
  const [vandaag] = useState(() => vandaagBrussel())
  const [weergave, setWeergave] = useState<Weergave>(startWeergave === 'maand' || startWeergave === 'week' ? startWeergave : 'lijst')
  const [tab, setTab] = useState<Tab>(isDatum(startDatum) || startFactuur ? 'alles' : 'te_factureren')
  const [anker, setAnker] = useState<string>(isDatum(startDatum) ? startDatum : vandaag)
  const [filters, setFilters] = useState<Filters>(LEEG_FILTERS)
  const [sortering, setSortering] = useState<Sortering | null>(null)
  const [data, setData] = useState<Data | null>(null)
  const [laden, setLaden] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [geselecteerd, setGeselecteerd] = useState<string | null>(null)
  const [dag, setDag] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const [toonFilters, setToonFilters] = useState(false)
  const [toonDetails, setToonDetails] = useState(false)
  const [wizard, setWizard] = useState<WizardStaat>(null)
  const [geavanceerd, setGeavanceerd] = useState<string | null>(null)
  const [ronde, setRonde] = useState<Moment[] | null>(null)
  const [teVerwijderen, setTeVerwijderen] = useState<Moment | null>(null)
  const cache = useRef(new Map<string, Data>())
  const [versie, setVersie] = useState(0)
  const startGeopend = useRef(false)

  // ── Welke periode laden? Ruim genoeg dat achterstallige items uit vorige
  //    maanden en wat later gepland is altijd in “Te factureren” staan. ──
  const ym = ymVan(anker)
  const zicht = weergave === 'week' ? weekBereik(anker) : roosterBereik(ym)
  const bereik = useMemo(() => {
    // Ruim: een jaar terug en twee jaar vooruit, zodat een factuur die ver vooruit gepland is nooit "verdwijnt".
    const van = [zicht.van, plusDagen(vandaag, -400), filters.van || zicht.van].sort()[0]
    let tot = [zicht.tot, plusDagen(vandaag, 760), filters.tot || zicht.tot].sort().slice(-1)[0]
    if ((Date.parse(tot) - Date.parse(van)) / 86_400_000 > MAX_DAGEN) tot = plusDagen(van, MAX_DAGEN)
    return { van, tot }
  }, [zicht.van, zicht.tot, vandaag, filters.van, filters.tot])
  const sleutel = `${bereik.van}|${bereik.tot}`

  const laad = useCallback(async (key: string, van: string, tot: string) => {
    const bekend = cache.current.get(key)
    if (bekend) { setData(bekend); return }
    setLaden(true); setFout(null)
    try {
      const r = await fetch(`/api/admin/invoices/planner?van=${van}&tot=${tot}`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Laden mislukt')
      cache.current.set(key, j as Data); setData(j as Data)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [])
  useEffect(() => { laad(sleutel, bereik.van, bereik.tot) }, [sleutel, bereik.van, bereik.tot, laad, versie])
  const ververs = useCallback(() => { cache.current.clear(); setVersie((v) => v + 1) }, [])

  // ── Afgeleide gegevens ──
  const alle = useMemo(() => data?.momenten ?? [], [data])
  const gefilterd = useMemo(() => pasFiltersToe(alle, { ...filters, toonGeannuleerd: true, fase: '', categorie: null }, vandaag), [alle, filters, vandaag])
  const open = useMemo(() => gefilterd.filter((m) => tabVan(m) === 'te_factureren'), [gefilterd])
  // Achterstallig blijft in zijn eigen geplande maand; hier enkel een wegwijzer naar eerdere maanden.
  const eerderAchterstallig = open.filter((m) => m.status === 'achterstallig' && ymVan(m.datum) < ym).sort((a, b) => a.datum.localeCompare(b.datum))
  const vandaagTe = rondeItems(gefilterd, vandaag)
  // Alle tabbladen tonen de geselecteerde maand, op geplande facturatiedatum.
  const maandBereik = weergave === 'week' ? zicht : { van: maandStart(ym), tot: maandEind(ym) }
  const maandBasis = useMemo(() => gefilterd.filter((m) => m.datum >= maandBereik.van && m.datum <= maandBereik.tot), [gefilterd, maandBereik.van, maandBereik.tot])
  // "Alle nog te versturen" kijkt over alle maanden heen.
  const tabBasis = isMaandloos(tab) ? gefilterd : maandBasis
  const tellingen = useMemo(() => ({ ...tabTellingen(maandBasis), open_alle: gefilterd.filter((m) => tabVan(m) === 'te_factureren').length }), [maandBasis, gefilterd])
  const lijst = useMemo(() => {
    let l = tabBasis.filter((m) => inTab(m, tab))
    if (!filters.toonGeannuleerd && tab !== 'alles') l = l.filter((m) => m.status !== 'geannuleerd' && m.status !== 'gecrediteerd')
    return sortering ? sorteer(l, sortering) : tab === 'te_factureren' ? sorteerWerklijst(l) : sorteer(l, { veld: 'datum', richting: 'asc' })
  }, [tabBasis, tab, sortering, filters.toonGeannuleerd])
  // Totaalbalk: exact de zichtbare lijst (met zoeken en filters).
  const zichtbaarOpen = lijst.filter((m) => tabVan(m) === 'te_factureren')
  const zichtbaarOpenTotaal = Math.round(zichtbaarOpen.reduce((s, m) => s + m.bedrag_excl, 0) * 100) / 100
  // Maandoverzicht en omzetmeter: altijd de VOLLEDIGE maand, los van zoeken/filters/tab.
  const overzicht = useMemo(() => maandOverzicht(alle, ym), [alle, ym])
  const meter = useMemo(() => omzetMeter(alle, ym), [alle, ym])
  const lijstTotaal = lijst.filter((m) => m.status !== 'geannuleerd' && m.status !== 'gecrediteerd').reduce((s, m) => s + m.bedrag_excl, 0)
  const perDag = useMemo(() => { const m = new Map<string, Moment[]>(); for (const x of gefilterd.filter((y) => filters.toonGeannuleerd || (y.status !== 'geannuleerd' && y.status !== 'gecrediteerd'))) { const l = m.get(x.datum) ?? []; l.push(x); m.set(x.datum, l) } return m }, [gefilterd, filters.toonGeannuleerd])
  const totalen = useMemo(() => dagTotalen(gefilterd), [gefilterd])
  const geselecteerdMoment = geselecteerd ? alle.find((m) => m.id === geselecteerd) ?? null : null
  const typen = useMemo(() => [...new Set(alle.map((m) => m.type))].sort(), [alle])
  const verantwoordelijken = useMemo(() => [...new Set(alle.map((m) => m.verantwoordelijke).filter((v): v is string => !!v))].sort(), [alle])
  // Secundair: kosten, winst en betalingen van de gekozen maand.
  const maandMomenten = useMemo(() => gefilterd.filter((m) => m.datum >= maandBereik.van && m.datum <= maandBereik.tot), [gefilterd, maandBereik.van, maandBereik.tot])
  const fk = useMemo(() => faseKpi(maandMomenten), [maandMomenten])
  const res = useMemo(() => resultaat(maandMomenten), [maandMomenten])
  const kpi = useMemo(() => maandKpi(maandMomenten, ym), [maandMomenten, ym])

  // Na het opslaan: het nieuwe item opzoeken. Valt het buiten de gekozen maand of
  // het tabblad, dan een melding met "Factuur bekijken" (maand + status erbij).
  const naOpslaan = useRef<{ id: string; datum: string | null } | null>(null)
  const opgeslagen = useCallback((id: string | null, datum?: string | null) => {
    if (id) naOpslaan.current = { id, datum: datum ?? null }
    ververs()
  }, [ververs])
  useEffect(() => {
    const p = naOpslaan.current
    if (!p || !data || laden) return
    const m = data.momenten.find((x) => x.invoice_id === p.id)
    if (!m) {
      // Buiten het geladen venster: naar de maand van de factuur springen (laadt die maand).
      if (p.datum && ymVan(p.datum) !== ym) { setAnker(p.datum); return }
      naOpslaan.current = null
      return
    }
    naOpslaan.current = null
    const zichtbaar = (isMaandloos(tab) || ymVan(m.datum) === ym) && inTab(m, tab)
    const label = STATUS_INFO[m.status]?.label ?? m.status
    if (zichtbaar) { setGeselecteerd(null); return }
    toast.success(`Opgeslagen: ${m.klant ?? 'factuur'} staat in ${maandNaam(ymVan(m.datum))} · ${label}.`, {
      duration: 10000,
      action: { label: 'Factuur bekijken', onClick: () => { setAnker(m.datum); setTab(tabVan(m) === 'te_factureren' ? 'te_factureren' : 'alles'); setWeergave('lijst'); setGeselecteerd(m.id) } },
    })
  }, [data, laden, tab, ym])

  // Link vanuit elders (?factuur=…): dat item meteen openen.
  useEffect(() => {
    if (!startFactuur || startGeopend.current || !data) return
    const m = data.momenten.find((x) => x.invoice_id === startFactuur)
    startGeopend.current = true
    if (m) setGeselecteerd(m.id); else setGeavanceerd(startFactuur)
  }, [data, startFactuur])

  // ── Acties vanuit kalender/oude detail (verplaatsen, annuleren …) ──
  const voerUit = useCallback(async (actie: Actie, m: Moment, extra?: { datum?: string }): Promise<boolean> => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/invoices/planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie, id: m.id, datum: extra?.datum }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Actie mislukt')
      toast.success(j.melding ?? 'Bijgewerkt.'); ververs(); return true
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Actie mislukt'); return false } finally { setBezig(false) }
  }, [ververs])

  // ── Verwijderen: meteen weg uit lijst, totalen en meter; daarna bewaard ──
  const verwijder = useCallback(async (m: Moment, bereik: VerwijderBereik) => {
    const weg = (x: Moment) => x.id === m.id || (bereik === 'toekomst' && !!m.recurring_id && x.recurring_id === m.recurring_id && x.maand > m.maand && tabVan(x) !== 'gefactureerd')
    setData((d) => (d ? { ...d, momenten: d.momenten.filter((x) => !weg(x)) } : d))
    setTeVerwijderen(null)
    try {
      const r = await fetch('/api/admin/invoices/planner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'verwijder', id: m.id, bereik }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Verwijderen mislukt')
      toast.success(bereik === 'toekomst' ? 'Item en toekomstige herhalingen verwijderd.' : 'Facturatie-item verwijderd.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') }
    finally { cache.current.clear(); setVersie((v) => v + 1) }
  }, [])

  // ── Slepen in de kalender ──
  const [sleepDoel, setSleepDoel] = useState<string | null>(null)
  const sleepbaar = (m: Moment) => m.acties.kanVerplaatsen && m.status !== 'geannuleerd'
  const sleepStart = (e: React.DragEvent, m: Moment) => { if (!sleepbaar(m)) { e.preventDefault(); return } e.dataTransfer.setData('text/plain', m.id); e.dataTransfer.effectAllowed = 'move' }
  const sleepOver = (e: React.DragEvent, d: string) => { e.preventDefault(); if (sleepDoel !== d) setSleepDoel(d) }
  const laatVallen = async (e: React.DragEvent, d: string) => {
    e.preventDefault(); setSleepDoel(null)
    const m = alle.find((x) => x.id === e.dataTransfer.getData('text/plain'))
    if (m && sleepbaar(m) && m.datum !== d) await voerUit('verplaats', m, { datum: d })
  }

  const ga = (richting: -1 | 1) => setAnker((a) => (weergave === 'week' ? plusDagen(a, 7 * richting) : `${shiftYM(ymVan(a), richting)}-01`))
  const zet = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }))
  const sorteerOp = (veld: Sortering['veld']) => setSortering((s) => ({ veld, richting: s?.veld === veld && s.richting === 'asc' ? 'desc' : 'asc' }))
  const bekijk = (m: Moment) => setGeselecteerd(m.id)

  const naarExport = (m: Moment): FactuurExportRij => ({
    kind: m.bron === 'recurring' ? 'recurring' : 'eenmalig', sourceId: m.bronId, client_id: m.client_id, service_slug: null,
    description: [m.project ?? m.dienst, m.omschrijving].filter(Boolean).join(' — ') || null,
    amount_excl: m.bedrag_excl, vat_pct: m.btw_pct, amount_incl: m.bedrag_incl,
    status: m.status === 'verstuurd' || m.status === 'betaald' ? 'verstuurd' : m.status === 'geannuleerd' || m.status === 'gecrediteerd' ? 'geannuleerd' : 'te_versturen',
    billing_date: m.datum, contract_title: m.contract_titel,
  })
  const exportWerkmap = () => {
    const klantNamen = new Map((data?.klanten ?? []).map((k) => [k.id, k.company_name]))
    return facturenWerkmap({
      month: ym, rijen: lijst.map(naarExport), alleRijen: maandMomenten.map(naarExport),
      klantNaam: (id) => (id ? klantNamen.get(id) ?? '—' : '—'),
      filters: filtersActief(filters) ? [{ label: 'Filters', waarde: 'actief' }] : [],
      summary: { omzetExcl: kpi.gepland, openExcl: kpi.teFactureren, doneExcl: kpi.verstuurd, pct: kpi.gepland > 0 ? Math.round((kpi.verstuurd / kpi.gepland) * 100) : 0 },
    })
  }

  const maandNav = (
    <div className="flex items-center gap-1.5">
      <button type="button" onClick={() => ga(-1)} className="rounded-lg border border-gray-200 p-1.5 hover:bg-gray-50" aria-label="Vorige periode"><ChevronLeft className="h-4 w-4" /></button>
      <span className="text-sm font-semibold capitalize min-w-[120px] text-center">{weergave === 'week' ? `week van ${datumKort(zicht.van)}` : maandNaam(ym)}</span>
      <button type="button" onClick={() => ga(1)} className="rounded-lg border border-gray-200 p-1.5 hover:bg-gray-50" aria-label="Volgende periode"><ChevronRight className="h-4 w-4" /></button>
      <button type="button" onClick={() => setAnker(vandaag)} disabled={ym === ymVan(vandaag) && weergave !== 'week'} className="text-xs px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">Nu</button>
    </div>
  )

  return (
    <div className="space-y-4">
      {/* ── Bovenaan: het maandelijkse omzetdoel van de geselecteerde maand + acties ── */}
      <div className="flex items-stretch gap-3 flex-wrap">
        <section className="card-base p-4 flex-1 min-w-[280px]" aria-label="Maandelijks omzetdoel">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5"><Target className="h-4 w-4" />Maandelijks omzetdoel</h2>
              <div className="text-xs text-gray-500"><span className="capitalize">{maandNaam(ym)}</span> · Volledige maand · Excl. btw</div>
            </div>
            {meter.bereikt && <span className="inline-flex items-center gap-1 rounded-full bg-[#166534] text-white px-2.5 py-0.5 text-[11px] font-semibold"><CheckCircle2 className="h-3 w-3" />Maanddoel bereikt</span>}
          </div>
          <div className="flex items-baseline gap-2 flex-wrap mt-1">
            <span className="text-2xl font-bold tabular-nums">{euro2(meter.verwacht)}</span>
            <span className="text-sm text-gray-500 tabular-nums">/ {euro(MAAND_DOEL)}</span>
            <span className="text-sm font-semibold tabular-nums">· {meter.pct.toLocaleString('nl-BE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span>
            {!meter.bereikt && <span className="text-sm text-gray-600 tabular-nums">· Nog {euro2(meter.nodig)} tot het maanddoel</span>}
          </div>
          <div className="mt-2 h-3 rounded-full bg-gray-200 overflow-hidden flex" role="img" aria-label={`${euro2(meter.gefactureerd)} gefactureerd en ${euro2(meter.open)} nog te factureren van ${euro(MAAND_DOEL)}`}>
            <div className="h-full bg-[#166534]" style={{ width: `${meter.vulGefactureerd}%` }} />
            <div className="h-full bg-[#facc15]" style={{ width: `${meter.vulOpen}%` }} />
          </div>
          <div className="mt-1.5 flex gap-x-4 gap-y-1 flex-wrap text-xs text-gray-700">
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#166534]" /><b className="tabular-nums">{euro2(meter.gefactureerd)}</b> gefactureerd</span>
            <span className="text-gray-400">+</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm bg-[#facc15]" /><b className="tabular-nums">{euro2(meter.open)}</b> nog te factureren</span>
            {!meter.bereikt && <span className="inline-flex items-center gap-1.5 text-gray-500"><span className="h-2.5 w-2.5 rounded-sm bg-gray-200 border border-gray-300" />{euro2(meter.nodig)} resterend tot het doel</span>}
          </div>
          {eerderAchterstallig.length > 0 && (
            <button type="button" onClick={() => { setAnker(eerderAchterstallig[0].datum); setTab('te_factureren') }} className="mt-2 inline-flex items-center gap-1 rounded-full bg-orange-500 text-white px-2.5 py-0.5 text-[11px] font-medium hover:bg-orange-600">
              <AlertTriangle className="h-3 w-3" />{eerderAchterstallig.length} achterstallig in eerdere maanden — bekijken
            </button>
          )}
        </section>
        <div className="flex flex-col sm:flex-row gap-2 items-stretch">
          <button type="button" onClick={() => setRonde(vandaagTe)} className="btn-secondary text-sm border-black justify-center" title="Alle items t.e.m. vandaag, achterstallige inbegrepen, één voor één afwerken">
            <Play className="h-4 w-4" />Facturatieronde starten{vandaagTe.length ? ` (${vandaagTe.length})` : ''}
          </button>
          <button type="button" onClick={() => setWizard({ datum: ym === ymVan(vandaag) ? vandaag : `${ym}-01` })} className="btn-primary text-sm justify-center"><Plus className="h-4 w-4" />Nieuw facturatie-item</button>
        </div>
      </div>

      {/* ── Werkbalk ── */}
      <div className="card-base p-3 space-y-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div role="tablist" aria-label="Facturen" className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} type="button" onClick={() => { setTab(t.key); setSortering(null); if (weergave !== 'lijst') setWeergave('lijst') }}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === t.key && weergave === 'lijst' ? 'bg-black text-white' : 'text-gray-700 hover:bg-white'}`}>
                {t.label} <span className={`ml-1 tabular-nums text-xs ${tab === t.key && weergave === 'lijst' ? 'text-[#fff848]' : 'text-gray-500'}`}>{tellingen[t.key]}</span>
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative"><Search className="h-3.5 w-3.5 text-gray-400 absolute left-2 top-1/2 -translate-y-1/2" /><input className={`${sel} pl-7 w-44 sm:w-52`} placeholder="Zoek klant, project…" value={filters.project} onChange={(e) => zet('project', e.target.value)} aria-label="Zoeken" /></div>
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              {([['lijst', List, 'Lijst'], ['maand', CalendarDays, 'Kalender'], ['week', CalendarRange, 'Week']] as const).map(([w, Icon, label]) => (
                <button key={w} type="button" onClick={() => setWeergave(w)} className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium ${weergave === w ? 'bg-black text-white' : 'text-gray-600 hover:bg-white'}`}><Icon className="h-3.5 w-3.5" />{label}</button>
              ))}
            </div>
            <button type="button" onClick={() => setToonFilters((v) => !v)} className={`btn-secondary text-xs ${filtersActief(filters) ? 'ring-1 ring-black' : ''}`}><Filter className="h-3.5 w-3.5" />Filters{filtersActief(filters) ? ' •' : ''}</button>
            {filtersActief(filters) && <button type="button" onClick={() => setFilters(LEEG_FILTERS)} className="btn-secondary text-xs"><X className="h-3.5 w-3.5" />Wissen</button>}
            <ExportKnop werkmap={exportWerkmap} label="Excel" className="btn-secondary text-xs" title="Exporteer de lijst naar Excel" />
            {laden && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          </div>
        </div>
        {weergave === 'lijst' && (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            {maandNav}
            <span className="text-xs text-gray-500">Op geplande facturatiedatum{filtersActief(filters) ? ' · met je zoekopdracht/filters' : ''}</span>
          </div>
        )}
        {weergave !== 'lijst' && <div className="flex items-center gap-2 flex-wrap">{maandNav}<input type="month" value={ym} onChange={(e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) setAnker(`${e.target.value}-01`) }} className={sel} aria-label="Maand kiezen" /></div>}

        {toonFilters && (
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-5 gap-2 pt-2 border-t border-gray-100">
            <div className="flex items-center gap-1 col-span-2"><input type="date" className={`${sel} flex-1`} value={filters.van} onChange={(e) => zet('van', e.target.value)} aria-label="Periode van" /><span className="text-xs text-gray-400">–</span><input type="date" className={`${sel} flex-1`} value={filters.tot} onChange={(e) => zet('tot', e.target.value)} aria-label="Periode tot" /></div>
            <select className={sel} value={filters.klant} onChange={(e) => zet('klant', e.target.value)}><option value="">Alle klanten</option>{(data?.klanten ?? []).map((k) => <option key={k.id} value={k.id}>{k.company_name}</option>)}</select>
            <select className={sel} value={filters.status} onChange={(e) => zet('status', e.target.value as Filters['status'])}><option value="">Alle statussen</option>{PLANNER_STATUSSEN.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}</select>
            <select className={sel} value={filters.type} onChange={(e) => zet('type', e.target.value)}><option value="">Alle types</option>{typen.map((t) => <option key={t} value={t}>{t}</option>)}</select>
            <select className={sel} value={filters.terugkerend} onChange={(e) => zet('terugkerend', e.target.value as Filters['terugkerend'])}><option value="">Eenmalig en terugkerend</option><option value="eenmalig">Eenmalig</option><option value="terugkerend">Terugkerend</option></select>
            <select className={sel} value={filters.verantwoordelijke} onChange={(e) => zet('verantwoordelijke', e.target.value)}><option value="">Alle verantwoordelijken</option>{verantwoordelijken.map((v) => <option key={v} value={v}>{v}</option>)}</select>
            <label className="flex items-center gap-1.5 text-xs text-gray-600"><input type="checkbox" checked={filters.toonGeannuleerd} onChange={(e) => zet('toonGeannuleerd', e.target.checked)} />Toon geannuleerd</label>
          </div>
        )}
      </div>

      {fout && <div className="card-base text-sm text-red-700 bg-red-50 border-red-100">Laden mislukt: {fout}</div>}

      {/* ── Lijst ── */}
      {weergave === 'lijst' && (
        <div className="card-base p-0 overflow-hidden">
          {/* Telefoon: kaarten */}
          <div className="md:hidden divide-y divide-gray-100">
            {lijst.length === 0 && <LeegLijst tab={tab} onNieuw={() => setWizard({ datum: vandaag })} />}
            {lijst.map((m) => { const gef = tabVan(m) === 'gefactureerd'; const grijs = !tabVan(m); return (
              <div key={m.id} className={`flex items-stretch ${gef ? 'bg-[#166534] text-white' : grijs ? 'bg-gray-50 text-gray-500' : 'bg-white'}`}>
                <button type="button" onClick={() => bekijk(m)} className="flex-1 min-w-0 text-left px-3 py-3 space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0"><div className="font-semibold text-sm truncate">{m.klant}</div><div className={`text-xs truncate ${gef ? 'text-green-100' : 'text-gray-600'}`}>{m.project ?? m.dienst ?? m.omschrijving ?? '—'}</div></div>
                    <div className="font-bold tabular-nums text-sm shrink-0">{euro2(m.bedrag_excl)}</div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-[11px]"><StatusBadge status={m.status} klein /><span>{datumNlKort(m.datum)}</span>{m.terugkerend && <Repeat className="h-3 w-3" aria-label="terugkerend" />}{!m.volledig && !gef && <span className="text-amber-700">gegevens ontbreken</span>}</div>
                </button>
                {(m.bron === 'invoice' || m.bron === 'recurring') && <button type="button" onClick={() => setTeVerwijderen(m)} className={`px-3 ${gef ? 'text-white/80 hover:text-white' : 'text-red-600 hover:bg-red-50'}`} aria-label={`${m.klant} verwijderen`}><Trash2 className="h-4 w-4" /></button>}
              </div>
            ) })}
          </div>
          {/* Desktop: compacte tabel, geen horizontaal scrollen */}
          <table className="hidden md:table w-full text-sm table-fixed">
            <colgroup><col className="w-[118px]" /><col className="w-[20%]" /><col className="w-[18%]" /><col /><col className="w-[118px]" /><col className="w-[178px]" /><col className="w-[140px]" /></colgroup>
            <thead>
              <tr className="text-left text-[11px] text-gray-500 uppercase tracking-wide bg-gray-50 border-b border-gray-100">
                <Kop veld="datum" sortering={sortering} onClick={sorteerOp}>Gepland</Kop>
                <Kop veld="klant" sortering={sortering} onClick={sorteerOp}>Klant</Kop>
                <th className="px-3 py-2 font-medium">Project / dienst</th>
                <th className="px-3 py-2 font-medium">Omschrijving</th>
                <Kop veld="bedrag" sortering={sortering} onClick={sorteerOp} rechts>Excl. btw</Kop>
                <Kop veld="status" sortering={sortering} onClick={sorteerOp}>Status</Kop>
                <th className="px-3 py-2 font-medium text-right sr-only">Actie</th>
              </tr>
            </thead>
            <tbody>
              {lijst.length === 0 && <tr><td colSpan={7}><LeegLijst tab={tab} onNieuw={() => setWizard({ datum: vandaag })} /></td></tr>}
              {lijst.map((m) => { const gef = tabVan(m) === 'gefactureerd'; const grijs = !tabVan(m); return (
                <tr key={m.id} onClick={() => bekijk(m)} className={`cursor-pointer border-b ${gef ? 'bg-[#166534] text-white border-[#14532d] hover:bg-[#14532d]' : grijs ? 'bg-gray-50 text-gray-500 border-gray-100 hover:bg-gray-100' : 'bg-white border-gray-100 hover:bg-[#fff848]/15'}`}>
                  <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{datumNlKort(m.datum)}</td>
                  <td className="px-3 py-2.5 font-medium truncate" title={m.klant}>{m.klant}</td>
                  <td className="px-3 py-2.5 truncate" title={m.project ?? m.dienst ?? ''}><span className={gef ? 'text-green-50' : 'text-gray-600'}>{m.project ?? m.dienst ?? '—'}</span>{m.terugkerend && <Repeat className={`h-3 w-3 inline ml-1 -mt-0.5 ${gef ? 'text-green-100' : 'text-purple-700'}`} aria-label="terugkerend" />}</td>
                  <td className="px-3 py-2.5 truncate" title={m.omschrijving ?? ''}><span className={gef ? 'text-green-50' : 'text-gray-600'}>{m.omschrijving ?? '—'}</span>{m.opmerking && <StickyNote className={`h-3 w-3 inline ml-1 -mt-0.5 ${gef ? 'text-amber-200' : 'text-amber-500'}`} aria-label="interne notitie" />}{m.extern_nr && <span className={`ml-1 text-[11px] ${gef ? 'text-green-100' : 'text-gray-400'}`}>· nr {m.extern_nr}</span>}</td>
                  <td className="px-3 py-2.5 text-right font-semibold tabular-nums">{euro2(m.bedrag_excl)}</td>
                  <td className="px-3 py-2.5"><StatusBadge status={m.status} /></td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap">
                    <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium ${gef ? 'border-white/40 text-white' : 'border-gray-200 text-gray-700 bg-white'}`}><Eye className="h-3.5 w-3.5" />Bekijken</span>
                    {(m.bron === 'invoice' || m.bron === 'recurring') && (
                      <button type="button" onClick={(e) => { e.stopPropagation(); setTeVerwijderen(m) }} title="Verwijderen" aria-label={`${m.klant} verwijderen`}
                        className={`ml-1 inline-flex items-center justify-center h-7 w-7 rounded-lg border align-middle ${gef ? 'border-white/40 text-white hover:bg-white/10' : 'border-gray-200 bg-white text-red-600 hover:bg-red-50 hover:border-red-300'}`}><Trash2 className="h-3.5 w-3.5" /></button>
                    )}
                  </td>
                </tr>
              ) })}
            </tbody>
          </table>
          {/* Totaalbalk: de zichtbare lijst + het volledige maandoverzicht */}
          <div className="border-t-2 border-gray-900 bg-gray-50 px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6">
            <div className="flex items-baseline gap-4 flex-wrap">
              <div><div className="text-[11px] uppercase tracking-wide text-gray-500">Te factureren items</div><div className="text-xl font-bold tabular-nums">{zichtbaarOpen.length}</div></div>
              <div><div className="text-[11px] uppercase tracking-wide text-gray-500">Totaal nog te factureren — excl. btw</div><div className="text-xl font-bold tabular-nums">{euro2(zichtbaarOpenTotaal)}</div></div>
              {filtersActief(filters) && <span className="text-[11px] text-gray-500">volgens je zoekopdracht/filters</span>}
            </div>
            <div className="lg:ml-auto grid grid-cols-3 gap-2 text-xs rounded-xl border border-gray-200 bg-white p-2.5 min-w-0" aria-label="Volledige maand">
              <div><div className="text-gray-500">Al gefactureerd</div><div className="font-semibold tabular-nums text-[#166534]">{euro2(overzicht.gefactureerd)}</div></div>
              <div><div className="text-gray-500">Nog te factureren</div><div className="font-semibold tabular-nums">{euro2(overzicht.open)}</div></div>
              <div><div className="text-gray-500">Verwacht maandtotaal</div><div className="font-bold tabular-nums">{euro2(overzicht.totaal)}</div></div>
              <div className="col-span-3 text-[10px] text-gray-400 capitalize">{maandNaam(ym)} · volledige maand · excl. btw</div>
            </div>
          </div>
        </div>
      )}

      {/* ── Kalender (tweede weergave) ── */}
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
                  className={`min-h-[64px] sm:min-h-[112px] border-b border-r border-gray-100 p-1 sm:p-1.5 flex flex-col ${inMaand ? 'bg-white' : 'bg-gray-50/60'} ${isVandaag ? 'ring-2 ring-inset ring-[#fff848]' : ''} ${sleepDoel === d ? 'bg-[#fff848]/30 ring-2 ring-inset ring-black' : ''}`}>
                  <button type="button" onClick={() => setDag(d)} className="flex items-start justify-between gap-1 text-left w-full">
                    <span className={`text-xs font-medium h-5 min-w-5 px-1 inline-flex items-center justify-center rounded-full ${isVandaag ? 'bg-[#fff848] text-black' : inMaand ? 'text-gray-800' : 'text-gray-400'}`}>{Number(d.slice(8, 10))}</span>
                    {t && <span className="text-[10px] text-gray-500 text-right leading-tight"><b className="text-gray-800">{t.aantal}</b><span className="hidden sm:inline"> · {euro(t.bedrag)}</span></span>}
                  </button>
                  <div className="hidden sm:flex flex-col gap-0.5 mt-1">
                    {toon.map((m) => (
                      <button key={m.id} type="button" onClick={() => bekijk(m)} title={`${kort(m)} · ${STATUS_INFO[m.status].label}`} draggable={sleepbaar(m)} onDragStart={(e) => sleepStart(e, m)}
                        className={`text-left text-[10.5px] leading-tight px-1.5 py-0.5 rounded border truncate ${STATUS_INFO[m.status].cls} ${sleepbaar(m) ? 'cursor-grab' : ''}`}>{kort(m)}</button>
                    ))}
                    {meer > 0 && <button type="button" onClick={() => setDag(d)} className="text-[10.5px] text-gray-500 hover:text-black text-left px-1.5">+{meer} meer</button>}
                  </div>
                  {items.length > 0 && <button type="button" onClick={() => setDag(d)} className="sm:hidden mt-auto flex gap-0.5 flex-wrap">{items.slice(0, 6).map((m) => <span key={m.id} className={`h-1.5 w-1.5 rounded-full ${STATUS_INFO[m.status].stip}`} />)}</button>}
                </div>
              )
            })}
          </div>
          <p className="px-3 py-2 text-[11px] text-gray-500 hidden sm:block">Sleep een item naar een andere dag om de geplande facturatiedatum te verplaatsen.</p>
        </div>
      )}
      {weergave === 'week' && (
        <div className="card-base p-0 overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-7 divide-y sm:divide-y-0 sm:divide-x divide-gray-100">
            {Array.from({ length: 7 }, (_, i) => plusDagen(zicht.van, i)).map((d, i) => {
              const items = perDag.get(d) ?? []
              const t = totalen.get(d)
              return (
                <div key={d} onDragOver={(e) => sleepOver(e, d)} onDragLeave={() => setSleepDoel((x) => (x === d ? null : x))} onDrop={(e) => laatVallen(e, d)}
                  className={`min-h-[120px] sm:min-h-[260px] p-2 ${d === vandaag ? 'bg-[#fff848]/10' : ''} ${sleepDoel === d ? 'bg-[#fff848]/30 ring-2 ring-inset ring-black' : ''}`}>
                  <button type="button" onClick={() => setDag(d)} className="w-full text-left flex items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-semibold text-gray-700">{DAGEN_KORT[i]} {Number(d.slice(8, 10))}</span>{t && <span className="text-[10px] text-gray-500">{t.aantal} · {euro(t.bedrag)}</span>}
                  </button>
                  <div className="space-y-1">
                    {items.map((m) => (
                      <button key={m.id} type="button" onClick={() => bekijk(m)} draggable={sleepbaar(m)} onDragStart={(e) => sleepStart(e, m)} className={`w-full text-left rounded-lg border px-2 py-1.5 ${STATUS_INFO[m.status].cls}`}>
                        <div className="text-xs font-medium truncate">{m.klant}</div><div className="text-[10.5px] truncate">{euro(m.bedrag_excl)} · {m.project ?? m.dienst ?? m.type}</div>
                      </button>
                    ))}
                    {items.length === 0 && <div className="text-[11px] text-gray-300">—</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Secundair: kosten, winst en betalingen ── */}
      <div className="card-base p-0 overflow-hidden">
        <button type="button" onClick={() => setToonDetails((x) => !x)} className="w-full flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-gray-700 hover:bg-gray-50">
          <span className="inline-flex items-center gap-2"><ChevronDown className={`h-4 w-4 transition-transform ${toonDetails ? '' : '-rotate-90'}`} />Details · kosten, winst en betalingen — <span className="capitalize">{maandNaam(ym)}</span></span>
          <span className="text-xs text-gray-500 font-normal">secundair</span>
        </button>
        {toonDetails && (
          <div className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {FASEN.map((f) => (
                <div key={f} className={`rounded-xl border border-l-4 p-3 ${FASE_INFO[f].kaart} ${FASE_INFO[f].rand}`}>
                  <div className="flex items-center justify-between text-[11px] font-medium text-gray-600"><span>{FASE_INFO[f].label}</span>{f === 'te_factureren' ? <Wallet className="h-3.5 w-3.5" /> : f === 'open' ? <Send className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}</div>
                  <div className={`text-xl font-bold mt-1 tabular-nums ${FASE_INFO[f].tekst}`}>{euro2(fk[f].bedrag)}</div>
                  <div className="text-[11px] text-gray-500">{fk[f].aantal} item{fk[f].aantal === 1 ? '' : 's'}{f === 'open' && kpi.verwachtBinnenAantal > 0 && <> · verwacht binnen deze maand: {euro(kpi.verwachtBinnen)}</>}</div>
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span>Omzet <b className="tabular-nums">{euro2(res.omzet)}</b></span>
              <span>Kosten bij facturen <b className="tabular-nums text-red-600">{euro2(res.kosten)}</b></span>
              <span>Winst <b className={`tabular-nums ${res.winst < 0 ? 'text-red-600' : 'text-green-700'}`}>{euro2(res.winst)}</b>{res.marge !== null && <span className="text-xs text-gray-500"> · marge {res.marge}%</span>}</span>
            </div>
            <p className="text-[11px] text-gray-500">Gefactureerd betekent niet automatisch betaald: betalingen duid je per item aan (Bekijken → Meer). Kosten log je per item via “Kosten en winst”.</p>
          </div>
        )}
      </div>

      {/* ── Vensters ── */}
      {dag && <DagPaneel datum={dag} momenten={perDag.get(dag) ?? []} onSluit={() => setDag(null)} onKies={(m) => { setDag(null); bekijk(m) }} onNieuw={(d) => { setDag(null); setWizard({ datum: d }) }} />}
      {geselecteerdMoment && (geselecteerdMoment.bron === 'invoice' || geselecteerdMoment.bron === 'recurring'
        ? <ItemDetail key={geselecteerdMoment.id} moment={geselecteerdMoment} onSluit={() => setGeselecteerd(null)} onGewijzigd={ververs}
            onBewerk={(id) => { setGeselecteerd(null); setWizard({ invoiceId: id }) }}
            onEigenArtikelen={(m) => { setGeselecteerd(null); setWizard({ recurringMaand: { recurring_id: m.bronId, maand: m.maand, momentId: m.id } }) }}
            onGeavanceerd={(id) => { setGeselecteerd(null); setGeavanceerd(id) }}
            onVerwijder={(m) => { setGeselecteerd(null); setTeVerwijderen(m) }} />
        : <PlannerDetail moment={geselecteerdMoment} onSluit={() => setGeselecteerd(null)} onActie={voerUit} bezig={bezig} onGewijzigd={ververs} />)}
      {wizard && (
        <FacturatieItemWizard
          invoiceId={'invoiceId' in wizard ? wizard.invoiceId : null}
          recurringMaand={'recurringMaand' in wizard ? wizard.recurringMaand : null}
          standaardDatum={'datum' in wizard ? wizard.datum : undefined}
          onClose={() => setWizard(null)} onSaved={(id, datum) => opgeslagen(id, datum)} />
      )}
      {geavanceerd && <FactuurEditor invoiceId={geavanceerd} onClose={() => setGeavanceerd(null)} onSaved={() => ververs()} />}
      {teVerwijderen && <VerwijderDialoog m={teVerwijderen} onAnnuleer={() => setTeVerwijderen(null)} onBevestig={(bereik) => verwijder(teVerwijderen, bereik)} />}
      {ronde && <Facturatieronde items={ronde} onSluit={() => { setRonde(null); ververs() }} onGewijzigd={ververs} />}
    </div>
  )
}

const datumNlKort = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

function LeegLijst({ tab, onNieuw }: { tab: Tab; onNieuw: () => void }) {
  return (
    <div className="px-4 py-10 text-center text-sm text-gray-500 space-y-2">
      <div>{tab === 'open_alle' ? 'Niets meer te versturen.' : tab === 'te_factureren' ? 'Geen items te factureren deze maand.' : tab === 'gefactureerd' ? 'Nog niets gefactureerd deze maand.' : 'Geen items deze maand.'}</div>
      <button type="button" onClick={onNieuw} className="btn-primary text-sm"><Plus className="h-4 w-4" />Nieuw facturatie-item</button>
    </div>
  )
}

function Kop({ veld, sortering, onClick, children, rechts }: { veld: Sortering['veld']; sortering: Sortering | null; onClick: (v: Sortering['veld']) => void; children: React.ReactNode; rechts?: boolean }) {
  const actief = sortering?.veld === veld
  return (
    <th className={`px-3 py-2 font-medium ${rechts ? 'text-right' : ''}`}>
      <button type="button" onClick={() => onClick(veld)} className={`inline-flex items-center gap-1 uppercase tracking-wide ${actief ? 'text-black' : ''}`}>{children}<ArrowUpDown className={`h-3 w-3 ${actief ? '' : 'opacity-40'}`} /></button>
    </th>
  )
}
