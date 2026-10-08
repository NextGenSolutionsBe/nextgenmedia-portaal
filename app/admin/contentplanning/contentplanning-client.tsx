'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Plus, Search, Filter, Settings2, Loader2, X, CalendarDays, CalendarRange, Calendar, LayoutGrid } from 'lucide-react'
import { INP } from '@/app/admin/instellingen/ui'
import { fasesVanMaand, reeksenVanDag, isKlaar, maandVan, maandag, plusDagen, plusMaanden, maandStart, maandEind, REEKSEN, type Reeks } from '@/lib/contentplanning/model'
import { DagWeergave, WeekWeergave, MaandWeergave, Klantenbord } from './weergaven'
import { TaakPaneel, KlantFiche, InstellingenPaneel } from './panelen'
import { Notities, Paneel, focusRing } from './bouwstenen'
import type { CpData, Doe, Filters, Notitie, Taak, Weergave } from './types'
import { LEGE_FILTERS, datumLang, maandNaam, vandaagBE } from './types'

/**
 * Contentplanning — Chiara’s centrale werkplanning. Eén set taken en gegevens,
 * vier weergaven (Dag · Week · Maand · Klantenbord). Een wijziging is meteen
 * overal zichtbaar. Laatst gekozen weergave en filters worden onthouden.
 */

type PaneelStaat =
  | { soort: 'taak'; taak: Taak | null; standaard?: Partial<Taak> }
  | { soort: 'klant'; id: string }
  | { soort: 'instellingen' }
  | { soort: 'notities'; scope: Partial<Notitie> & { titel: string } }
  | null

const VOORKEUR = 'ngm-contentplanning-v1'
const WEERGAVEN: { key: Weergave; label: string; icon: typeof Calendar }[] = [
  { key: 'dag', label: 'Dag', icon: Calendar }, { key: 'week', label: 'Week', icon: CalendarRange },
  { key: 'maand', label: 'Maand', icon: CalendarDays }, { key: 'bord', label: 'Klantenbord', icon: LayoutGrid },
]

export function ContentplanningClient() {
  const vandaag = useMemo(() => vandaagBE(), [])
  const [weergave, setWeergave] = useState<Weergave>('dag')
  const [filters, setFilters] = useState<Filters>(LEGE_FILTERS)
  const [anker, setAnker] = useState(vandaag)
  const [data, setData] = useState<CpData | null>(null)
  const [laden, setLaden] = useState(true)
  const [fout, setFout] = useState<string | null>(null)
  const [paneel, setPaneel] = useState<PaneelStaat>(null)
  const [meerFilters, setMeerFilters] = useState(false)
  const [versie, setVersie] = useState(0)
  const geladen = useRef(false)

  // Voorkeuren onthouden (weergave + filters), per browser van de gebruiker.
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(VOORKEUR) ?? 'null'); if (v?.weergave) setWeergave(v.weergave); if (v?.filters) setFilters({ ...LEGE_FILTERS, ...v.filters }) } catch { /* geen opslag */ }
    geladen.current = true
  }, [])
  useEffect(() => { if (!geladen.current) return; try { localStorage.setItem(VOORKEUR, JSON.stringify({ weergave, filters })) } catch { /* geen opslag */ } }, [weergave, filters])

  // Periode laden: de maand (6 weken rooster) én de week rond het anker.
  const ym = maandVan(anker)
  const van = [maandag(maandStart(ym)), maandag(anker)].sort()[0]
  const tot = [plusDagen(maandag(maandStart(ym)), 41), plusDagen(maandag(anker), 6), maandEind(ym)].sort().slice(-1)[0]
  const laad = useCallback(async () => {
    setFout(null)
    try {
      const r = await fetch(`/api/admin/contentplanning?van=${van}&tot=${tot}`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Laden mislukt')
      setData(j as CpData)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [van, tot])
  useEffect(() => { laad() }, [laad, versie])
  const ververs = useCallback(() => setVersie((v) => v + 1), [])

  /** Bewaren met zichtbare feedback; verwijderen altijd met “Ongedaan maken”. */
  const doe: Doe = useCallback(async (actie, body = {}, opts = {}) => {
    try {
      const r = await fetch('/api/admin/contentplanning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie, ...body }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      const herstel = actie === 'taak.verwijder' ? 'taak.herstel' : actie === 'notitie.verwijder' ? 'notitie.herstel' : actie === 'klant.verwijder' ? 'klant.herstel' : null
      if (herstel) {
        toast.success(opts.melding ?? 'Verwijderd.', { action: { label: 'Ongedaan maken', onClick: async () => { const rr = await fetch('/api/admin/contentplanning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: herstel, ...body }) }); if (rr.ok) { toast.success('Hersteld.'); ververs() } else toast.error('Herstellen mislukt.') } } })
      } else if (!opts.stil) toast.success(opts.melding ?? 'Bewaard.')
      ververs()
      return j
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); ververs(); return null }
  }, [ververs])

  // Snelle acties: meteen zichtbaar, daarna bewaard.
  const lokaal = (id: string, deel: Partial<Taak>) => setData((d) => (d ? { ...d, taken: d.taken.map((t) => (t.id === id ? { ...t, ...deel } : t)) } : d))
  const vink = useCallback((t: Taak) => {
    if (!data) return
    const klaar = isKlaar(t.status, data.instellingen.statussen)
    const status = klaar ? (t.werkdatum ? 'ingepland' : 'nog_in_te_plannen') : 'afgerond'
    lokaal(t.id, { status })
    doe('taak.wijzig', { id: t.id, status }, { stil: true })
  }, [data, doe])
  /** Verslepen of een datum kiezen wijzigt enkel de WERKDATUM; de deadline blijft. */
  const verplaats = useCallback((t: Taak, datum: string | null) => {
    lokaal(t.id, { werkdatum: datum, status: t.status === 'nog_in_te_plannen' && datum ? 'ingepland' : t.status })
    doe('taak.wijzig', { id: t.id, werkdatum: datum }, { melding: datum ? `Werkdatum: ${datumLang(datum)}${t.deadline ? ' · deadline ongewijzigd' : ''}` : 'Terug naar nog in te plannen.' })
  }, [doe])

  // ── Afgeleid ──
  const klantNaamMap = useMemo(() => new Map((data?.klanten ?? []).map((k) => [k.id, k.company_name])), [data])
  const klantNaam = useCallback((id: string | null) => (id ? klantNaamMap.get(id) ?? null : null), [klantNaamMap])
  const batchVan = useMemo(() => new Map((data?.klanten ?? []).map((k) => [k.id, k.batch_id])), [data])
  const notitieTelling = useMemo(() => { const m = new Map<string, number>(); for (const n of data?.notities ?? []) if (n.taak_id) m.set(n.taak_id, (m.get(n.taak_id) ?? 0) + 1); return m }, [data])
  const reeksCache = useMemo(() => new Map<string, Map<string, Reeks[]>>(), [data])
  const reeksenOp = useCallback((d: string): Reeks[] => {
    if (!data) return []
    const m = maandVan(d)
    if (!reeksCache.has(m)) {
      const f = fasesVanMaand(m, data.faseAanpassingen)
      reeksCache.set(m, new Map([...f.entries()].map(([dag, fs]) => [dag, reeksenVanDag(fs, data.instellingen.fase_reeks)])))
    }
    return reeksCache.get(m)!.get(d) ?? []
  }, [data, reeksCache])
  const klantFilter = useCallback((cid: string | null) => {
    if (filters.klant && cid !== filters.klant) return false
    if (filters.batch && (cid ? batchVan.get(cid) ?? '' : '') !== (filters.batch === '__geen' ? '' : filters.batch)) return false
    return true
  }, [filters.klant, filters.batch, batchVan])
  const taken = useMemo(() => {
    if (!data) return []
    const q = filters.zoek.trim().toLowerCase()
    return data.taken.filter((t) => {
      if (!klantFilter(t.client_id)) return false
      if (filters.verantwoordelijke && (t.verantwoordelijke ?? '') !== filters.verantwoordelijke) return false
      if (filters.reeks && String(t.reeks ?? '') !== filters.reeks) return false
      if (filters.nogOpen && isKlaar(t.status, data.instellingen.statussen)) return false
      // Gepauzeerde of gearchiveerde cyclus: niet in de werklijst.
      if (t.cyclus_id) { const c = data.cycli.find((x) => x.id === t.cyclus_id); if (c && c.status !== 'actief') return false }
      if (q && !`${t.titel} ${klantNaam(t.client_id) ?? ''} ${t.verantwoordelijke ?? ''}`.toLowerCase().includes(q)) return false
      return true
    })
  }, [data, filters, klantFilter, klantNaam])
  const aanDeBeurt = useMemo(() => {
    if (!data) return { zonderCyclus: 0, ontbrekend: 0 }
    const actief = data.cpKlanten.filter((k) => k.actief)
    return {
      zonderCyclus: actief.filter((k) => !data.cycli.some((c) => c.client_id === k.client_id && c.maand === ym)).length,
      ontbrekend: actief.filter((k) => !k.ritme).length,
    }
  }, [data, ym])
  const klaarzetten = async () => {
    const r = await doe('cyclus.klaarzetten', { maand: ym }, { stil: true })
    if (!r) return
    const ontbrekend = (r.ontbrekend as { client_id: string; reden: string }[] | undefined) ?? []
    toast.success(`${r.taken ?? 0} taak/taken klaargezet voor ${maandNaam(ym)}${Number(r.cycli) ? ` (${r.cycli} nieuwe cyclus${Number(r.cycli) === 1 ? '' : 'sen'})` : ''}.`)
    if (ontbrekend.length) toast.warning(`Nog in te vullen bij ${ontbrekend.length} klant(en): ${ontbrekend.slice(0, 3).map((o) => klantNaam(o.client_id)).join(', ')}${ontbrekend.length > 3 ? '…' : ''} — open de klantfiche.`)
  }

  // ── Navigatie ──
  const stap = (r: -1 | 1) => setAnker((a) => (weergave === 'dag' ? plusDagen(a, r) : weergave === 'week' ? plusDagen(a, 7 * r) : `${plusMaanden(maandVan(a), r)}-01`))
  const periode = weergave === 'dag' ? datumLang(anker) : weergave === 'week' ? `Week van ${datumLang(maandag(anker))}` : maandNaam(ym)
  const zet = <K extends keyof Filters>(k: K, v: Filters[K]) => setFilters((f) => ({ ...f, [k]: v }))
  const filtersAan = JSON.stringify(filters) !== JSON.stringify(LEGE_FILTERS)

  const props = data ? {
    data, taken, vandaag, anker, doe, klantNaam, notitiesVan: (id: string) => notitieTelling.get(id) ?? 0, reeksenOp,
    onTaak: (t: Taak | null, standaard?: Partial<Taak>) => setPaneel({ soort: 'taak', taak: t, standaard }),
    onKlant: (id: string) => setPaneel({ soort: 'klant', id }),
    onDag: (d: string) => { setAnker(d); setWeergave('dag') },
    onNotities: (scope: Partial<Notitie> & { titel: string }) => setPaneel({ soort: 'notities', scope }),
    vink, verplaats, kanSchrijven: data.kan.aanpassen || data.kan.beheren,
  } : null

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Contentplanning</h1>
          <p className="text-sm text-gray-500">Wat moet vandaag gebeuren, voor welke klant, en wat staat nog open.</p>
        </div>
        {data?.kan.beheren && <button type="button" onClick={() => setPaneel({ soort: 'instellingen' })} className={`btn-secondary text-sm ${focusRing}`}><Settings2 className="h-4 w-4" />Instellingen</button>}
      </div>

      {/* Werkbalk */}
      <div className="card-base p-3 space-y-2.5">
        <div className="flex items-center gap-2 flex-wrap">
          <div role="tablist" aria-label="Weergave" className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1">
            {WEERGAVEN.map((w) => (
              <button key={w.key} role="tab" aria-selected={weergave === w.key} type="button" onClick={() => setWeergave(w.key)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium ${weergave === w.key ? 'bg-black text-white' : 'text-gray-700 hover:bg-white'} ${focusRing}`}><w.icon className="h-4 w-4" /><span className="hidden sm:inline">{w.label}</span></button>
            ))}
          </div>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => stap(-1)} className={`rounded-lg border border-gray-200 p-2 hover:bg-gray-50 ${focusRing}`} aria-label="Vorige periode"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => setAnker(vandaag)} className={`rounded-lg border border-gray-200 px-3 py-1.5 text-sm hover:bg-gray-50 ${focusRing}`}>Vandaag</button>
            <button type="button" onClick={() => stap(1)} className={`rounded-lg border border-gray-200 p-2 hover:bg-gray-50 ${focusRing}`} aria-label="Volgende periode"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <span className="text-sm font-semibold capitalize">{periode}</span>
          {laden && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          <div className="flex-1" />
          {props?.kanSchrijven && <button type="button" onClick={() => setPaneel({ soort: 'taak', taak: null, standaard: { werkdatum: weergave === 'dag' ? anker : undefined } })} className={`btn-primary text-sm ${focusRing}`}><Plus className="h-4 w-4" />Toevoegen</button>}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative"><Search className="h-3.5 w-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" /><input className={`${INP} pl-8 py-1.5 w-48 sm:w-56`} placeholder="Zoek taak, klant, persoon…" value={filters.zoek} onChange={(e) => zet('zoek', e.target.value)} aria-label="Zoeken" /></div>
          <select className={`${INP} w-auto py-1.5`} value={filters.klant} onChange={(e) => zet('klant', e.target.value)} aria-label="Filter op klant"><option value="">Alle klanten</option>{(data?.klanten ?? []).filter((k) => data?.cpKlanten.some((c) => c.client_id === k.id && c.actief)).map((k) => <option key={k.id} value={k.id}>{k.company_name}</option>)}</select>
          <select className={`${INP} w-auto py-1.5`} value={filters.verantwoordelijke} onChange={(e) => zet('verantwoordelijke', e.target.value)} aria-label="Filter op verantwoordelijke"><option value="">Iedereen</option>{(data?.mensen ?? []).map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <button type="button" aria-pressed={filters.nogOpen} onClick={() => zet('nogOpen', !filters.nogOpen)} className={`rounded-full border px-3 py-1.5 text-xs font-medium ${filters.nogOpen ? 'bg-black text-white border-black' : 'bg-white border-gray-200 text-gray-700'} ${focusRing}`}>Nog open</button>
          <button type="button" onClick={() => setMeerFilters((x) => !x)} aria-expanded={meerFilters} className={`btn-secondary text-xs ${filters.reeks || filters.batch ? 'ring-1 ring-black' : ''} ${focusRing}`}><Filter className="h-3.5 w-3.5" />Filters</button>
          {filtersAan && <button type="button" onClick={() => setFilters(LEGE_FILTERS)} className={`btn-secondary text-xs ${focusRing}`}><X className="h-3.5 w-3.5" />Wissen</button>}
        </div>
        {meerFilters && (
          <div className="flex items-center gap-2 flex-wrap pt-1 border-t border-gray-100">
            <select className={`${INP} w-auto py-1.5`} value={filters.reeks} onChange={(e) => zet('reeks', e.target.value)} aria-label="Filter op reeks"><option value="">Alle reeksen</option>{REEKSEN.map((r) => <option key={r.nr} value={r.nr}>{r.label}</option>)}</select>
            <select className={`${INP} w-auto py-1.5`} value={filters.batch} onChange={(e) => zet('batch', e.target.value)} aria-label="Filter op batch"><option value="">Alle batches</option>{(data?.batches ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}<option value="__geen">Geen batch</option></select>
          </div>
        )}
      </div>

      {fout && <div className="card-base text-sm text-red-700 bg-red-50 border-red-100 flex items-center gap-2">Laden mislukt: {fout}<button type="button" onClick={ververs} className="btn-secondary text-xs ml-auto">Opnieuw</button></div>}
      {!data && !fout && <div className="card-base py-16 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /><div className="text-sm mt-2">Planning laden…</div></div>}

      {props && weergave === 'dag' && <DagWeergave {...props} aanDeBeurt={aanDeBeurt} onKlaarzetten={klaarzetten} />}
      {props && weergave === 'week' && <WeekWeergave {...props} />}
      {props && weergave === 'maand' && <MaandWeergave {...props} />}
      {props && weergave === 'bord' && <Klantenbord {...props} klantFilter={(id) => klantFilter(id)} onKlaarzetten={klaarzetten} />}

      {data && paneel?.soort === 'taak' && <TaakPaneel key={paneel.taak?.id ?? 'nieuw'} taak={paneel.taak} standaard={paneel.standaard} data={data} doe={doe} onSluit={() => setPaneel(null)} />}
      {data && paneel?.soort === 'klant' && <KlantFiche key={paneel.id} clientId={paneel.id} maand={ym} data={data} doe={doe} vandaag={vandaag} onSluit={() => setPaneel(null)} onTaak={(t, s) => setPaneel({ soort: 'taak', taak: t, standaard: s })} />}
      {data && paneel?.soort === 'instellingen' && <InstellingenPaneel data={data} doe={doe} onSluit={() => setPaneel(null)} />}
      {data && paneel?.soort === 'notities' && (
        <Paneel titel={paneel.scope.titel} onSluit={() => setPaneel(null)}>
          <Notities notities={data.notities.filter((n) => (paneel.scope.batch_id ? n.batch_id === paneel.scope.batch_id : true) && (paneel.scope.reeks ? n.reeks === paneel.scope.reeks && n.maand === paneel.scope.maand : true))}
            standaard={{ batch_id: paneel.scope.batch_id ?? null, reeks: paneel.scope.reeks ?? null, maand: paneel.scope.maand ?? null, soort: paneel.scope.soort ?? 'cyclus' }} doe={doe} kanSchrijven={data.kan.aanpassen || data.kan.beheren} />
        </Paneel>
      )}
    </div>
  )
}
