'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Settings2, Loader2, LayoutGrid, Layers, Route, ListChecks } from 'lucide-react'
import { fasesVanMaand, reeksenVanDag, isKlaar, maandVan, maandag, plusDagen, plusMaanden, maandStart, maandEind, type Reeks } from '@/lib/contentplanning/model'
import { Klantenbord } from './weergaven'
import { Klantenbatches } from './klantenbatches'
import { Reeksen } from './reeksen'
import { DagelijkseWerking, type WerkModus } from './werking'
import { TaakPaneel, KlantFiche, InstellingenPaneel } from './panelen'
import { Notities, Paneel, focusRing } from './bouwstenen'
import type { CpData, Doe, Notitie, Taak, Weergave } from './types'
import { datumLang, maandNaam, vandaagBE } from './types'

/**
 * Contentplanning — Chiara’s werkplanning. Vier weergaven op één set gegevens:
 * Dagelijkse werking · Reeksen · Batches · Klantenbord. Een wijziging is meteen
 * overal zichtbaar. Laatst gekozen weergave wordt onthouden.
 */

type PaneelStaat =
  | { soort: 'taak'; taak: Taak | null; standaard?: Partial<Taak> }
  | { soort: 'klant'; id: string }
  | { soort: 'instellingen' }
  | { soort: 'notities'; scope: Partial<Notitie> & { titel: string } }
  | null

const VOORKEUR = 'ngm-contentplanning-v1'
const WEERGAVEN: { key: Weergave; label: string; icon: typeof ListChecks }[] = [
  { key: 'werking', label: 'Dagelijkse werking', icon: ListChecks },
  { key: 'reeksen', label: 'Reeksen', icon: Route },
  { key: 'batches', label: 'Batches', icon: Layers },
  { key: 'bord', label: 'Klantenbord', icon: LayoutGrid },
]
const isWeergave = (v: unknown): v is Weergave => WEERGAVEN.some((w) => w.key === v)
const MODI: { key: WerkModus; label: string }[] = [{ key: 'dag', label: 'Dag' }, { key: 'week', label: 'Week' }, { key: 'maand', label: 'Maand' }]

export function ContentplanningClient() {
  const vandaag = useMemo(() => vandaagBE(), [])
  const [weergave, setWeergave] = useState<Weergave>('werking')
  const [werkModus, setWerkModus] = useState<WerkModus>('dag')
  const [anker, setAnker] = useState(vandaag)
  const [data, setData] = useState<CpData | null>(null)
  const [laden, setLaden] = useState(true)
  const [fout, setFout] = useState<string | null>(null)
  const [paneel, setPaneel] = useState<PaneelStaat>(null)
  const [versie, setVersie] = useState(0)
  const geladen = useRef(false)

  // Voorkeuren onthouden, per browser. Een oude weergave (dag/week/maand) valt terug op de dagelijkse werking.
  useEffect(() => {
    try {
      const v = JSON.parse(localStorage.getItem(VOORKEUR) ?? 'null')
      if (isWeergave(v?.weergave)) setWeergave(v.weergave)
      if (v?.werkModus === 'dag' || v?.werkModus === 'week' || v?.werkModus === 'maand') setWerkModus(v.werkModus)
    } catch { /* geen opslag */ }
    geladen.current = true
  }, [])
  useEffect(() => { if (!geladen.current) return; try { localStorage.setItem(VOORKEUR, JSON.stringify({ weergave, werkModus })) } catch { /* geen opslag */ } }, [weergave, werkModus])

  // Periode laden: de maand (6 weken rooster) én de week rond het anker.
  const ym = maandVan(anker)
  const van = [maandag(maandStart(ym)), maandag(anker)].sort()[0]
  const tot = [plusDagen(maandag(maandStart(ym)), 41), plusDagen(maandag(anker), 6), maandEind(ym)].sort().slice(-1)[0]
  const laad = useCallback(async () => {
    setFout(null); setLaden(true)
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
    doe('taak.wijzig', { id: t.id, werkdatum: datum }, { melding: datum ? `Werkdatum: ${datumLang(datum)}` : 'Terug naar nog in te plannen.' })
  }, [doe])

  // ── Afgeleid ──
  const klantNaamMap = useMemo(() => new Map((data?.klanten ?? []).map((k) => [k.id, k.company_name])), [data])
  const klantNaam = useCallback((id: string | null) => (id ? klantNaamMap.get(id) ?? null : null), [klantNaamMap])
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
  // Taken van een gepauzeerde of gearchiveerde cyclus horen niet in de werklijst.
  const taken = useMemo(() => (data?.taken ?? []).filter((t) => {
    if (!t.cyclus_id) return true
    const c = data!.cycli.find((x) => x.id === t.cyclus_id)
    return !c || c.status === 'actief'
  }), [data])
  const klaarzetten = async () => {
    const r = await doe('cyclus.klaarzetten', { maand: ym }, { stil: true })
    if (!r) return
    const ontbrekend = (r.ontbrekend as { client_id: string; reden: string }[] | undefined) ?? []
    toast.success(`${r.taken ?? 0} taak/taken klaargezet voor ${maandNaam(ym)}.`)
    if (ontbrekend.length) toast.warning(`Nog in te vullen bij ${ontbrekend.length} klant(en): ${ontbrekend.slice(0, 3).map((o) => klantNaam(o.client_id)).join(', ')}${ontbrekend.length > 3 ? '…' : ''}`)
  }

  // ── Navigatie: per dag, week of maand in de dagelijkse werking; per maand elders ──
  const periodeSoort: WerkModus = weergave === 'werking' ? werkModus : 'maand'
  const stap = (r: -1 | 1) => setAnker((a) => (periodeSoort === 'dag' ? plusDagen(a, r) : periodeSoort === 'week' ? plusDagen(a, 7 * r) : `${plusMaanden(maandVan(a), r)}-01`))
  const periode = periodeSoort === 'dag' ? datumLang(anker) : periodeSoort === 'week' ? `Week van ${datumLang(maandag(anker))}` : maandNaam(ym)
  const opVandaag = periodeSoort === 'dag' ? anker === vandaag : periodeSoort === 'week' ? maandag(anker) === maandag(vandaag) : ym === maandVan(vandaag)
  const woord = periodeSoort === 'dag' ? 'dag' : periodeSoort === 'week' ? 'week' : 'maand'

  const kanSchrijven = !!data && (data.kan.aanpassen || data.kan.beheren)
  const props = data ? {
    data, taken, vandaag, anker, doe, klantNaam, notitiesVan: (id: string) => notitieTelling.get(id) ?? 0, reeksenOp,
    onTaak: (t: Taak | null, standaard?: Partial<Taak>) => setPaneel({ soort: 'taak', taak: t, standaard }),
    onKlant: (id: string) => setPaneel({ soort: 'klant', id }),
    onDag: (d: string) => { setAnker(d); setWeergave('werking'); setWerkModus('dag') },
    onNotities: (scope: Partial<Notitie> & { titel: string }) => setPaneel({ soort: 'notities', scope }),
    vink, verplaats, kanSchrijven,
  } : null

  const pijl = `h-11 w-11 inline-flex items-center justify-center rounded-cp border border-cp-rand bg-cp-vlak hover:border-cp-ink transition-colors ${focusRing}`
  return (
    <div className="font-cp text-cp-ink space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-cp-titel">Dagelijkse planning Chiara</h1>
        {data?.kan.beheren && <button type="button" onClick={() => setPaneel({ soort: 'instellingen' })} className={`inline-flex items-center gap-2 h-11 px-4 rounded-cp border border-cp-rand bg-cp-vlak text-cp-basis font-medium hover:border-cp-ink transition-colors ${focusRing}`}><Settings2 className="h-5 w-5" />Instellingen</button>}
      </div>

      {/* Weergaven */}
      <div role="tablist" aria-label="Weergave" className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {WEERGAVEN.map((w) => (
          <button key={w.key} role="tab" aria-selected={weergave === w.key} type="button" onClick={() => setWeergave(w.key)}
            className={`inline-flex items-center justify-center gap-2 h-14 px-3 sm:px-4 rounded-cp border-2 text-sm sm:text-cp-basis font-semibold transition-all ${weergave === w.key ? 'bg-cp-ink text-cp-op-ink border-cp-ink shadow-md' : 'bg-cp-vlak border-cp-rand hover:border-cp-ink active:scale-[0.98]'} ${focusRing}`}>
            <w.icon className="h-5 w-5 shrink-0 hidden min-[400px]:block" /><span className="truncate">{w.label}</span>
          </button>
        ))}
      </div>

      {/* Periode */}
      <div className="flex items-center gap-2 flex-wrap">
        {weergave === 'werking' && (
          <div role="tablist" aria-label="Periode" className="inline-flex rounded-cp border border-cp-rand bg-cp-achtergrond p-1">
            {MODI.map((m) => (
              <button key={m.key} role="tab" type="button" aria-selected={werkModus === m.key} onClick={() => setWerkModus(m.key)}
                className={`h-9 px-4 rounded-lg text-cp-basis font-medium transition-colors ${werkModus === m.key ? 'bg-cp-ink text-cp-op-ink' : 'hover:bg-cp-vlak'} ${focusRing}`}>{m.label}</button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => stap(-1)} className={pijl} aria-label={`Vorige ${woord}`} title={`Vorige ${woord}`}><ChevronLeft className="h-5 w-5" /></button>
          <button type="button" onClick={() => stap(1)} className={pijl} aria-label={`Volgende ${woord}`} title={`Volgende ${woord}`}><ChevronRight className="h-5 w-5" /></button>
        </div>
        <span className="text-cp-kop inline-block first-letter:uppercase">{periode}</span>
        {!opVandaag && <button type="button" onClick={() => setAnker(vandaag)} className={`h-9 px-3 rounded-lg border border-cp-rand text-cp-klein font-medium hover:border-cp-ink ${focusRing}`}>Vandaag</button>}
        {laden && <Loader2 className="h-5 w-5 animate-spin text-cp-zacht" />}
      </div>

      {fout && <div className="rounded-cp border border-red-200 bg-red-50 p-4 text-cp-basis text-red-700 flex items-center gap-2">Laden mislukt: {fout}<button type="button" onClick={ververs} className="btn-secondary text-sm ml-auto">Opnieuw</button></div>}
      {!data && !fout && <div className="rounded-cp border border-cp-rand bg-cp-vlak py-20 text-center text-cp-zacht"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>}

      {props && weergave === 'werking' && <DagelijkseWerking data={props.data} anker={anker} vandaag={vandaag} doe={doe} modus={werkModus} onDag={props.onDag} onKlant={props.onKlant} onWeergave={setWeergave} reeksenOp={reeksenOp} />}
      {props && weergave === 'reeksen' && <Reeksen data={props.data} maand={ym} doe={doe} vandaag={vandaag} onDag={props.onDag} />}
      {props && weergave === 'batches' && <Klantenbatches data={props.data} maand={ym} doe={doe} onKlant={props.onKlant} onKlaarzetten={klaarzetten} />}
      {props && weergave === 'bord' && <Klantenbord {...props} />}

      {data && paneel?.soort === 'taak' && <TaakPaneel key={paneel.taak?.id ?? 'nieuw'} taak={paneel.taak} standaard={paneel.standaard} data={data} doe={doe} onSluit={() => setPaneel(null)} />}
      {data && paneel?.soort === 'klant' && <KlantFiche key={paneel.id} clientId={paneel.id} maand={ym} data={data} doe={doe} vandaag={vandaag} onSluit={() => setPaneel(null)} onTaak={(t, s) => setPaneel({ soort: 'taak', taak: t, standaard: s })} />}
      {data && paneel?.soort === 'instellingen' && <InstellingenPaneel data={data} doe={doe} onSluit={() => setPaneel(null)} />}
      {data && paneel?.soort === 'notities' && (
        <Paneel titel={paneel.scope.titel} onSluit={() => setPaneel(null)}>
          <Notities notities={data.notities.filter((n) => (paneel.scope.batch_id ? n.batch_id === paneel.scope.batch_id : true) && (paneel.scope.reeks ? n.reeks === paneel.scope.reeks && n.maand === paneel.scope.maand : true))}
            standaard={{ batch_id: paneel.scope.batch_id ?? null, reeks: paneel.scope.reeks ?? null, maand: paneel.scope.maand ?? null, soort: paneel.scope.soort ?? 'cyclus' }} doe={doe} kanSchrijven={kanSchrijven} />
        </Paneel>
      )}
    </div>
  )
}
