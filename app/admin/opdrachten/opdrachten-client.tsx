'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Search, KanbanSquare, LayoutGrid, List, Sparkles, X, FileSpreadsheet, Settings2 } from 'lucide-react'
import {
  KOLOMMEN, kolomInfo, kolomVan, statusVoorKolom, stapLabel, kaartKleur, DIENSTEN, dienstInfo, sorteerInKolom, projectVerantwoordelijke,
  BEDRIJVEN, WAARDE_SCHIJVEN, inPeriode, inWaardeSchijf, bedrijfLabel,
  type KolomKey, type DienstKey, type Periode, type Bedrijf,
} from '@/lib/opdrachten-kanban'
import type { OpdrachtStatus } from '@/lib/opdrachten'
import { formatEuro } from '@/lib/utils'
import { KanbanBord } from './kanban-bord'
import { OpdrachtVenster } from './opdracht-venster'
import { VerplaatsDialoog, vraagBijVerplaatsen, type VerplaatsSoort } from './verplaats-dialoog'
import { AanvullenDialoog } from './aanvullen-dialoog'
import type { KaartOpdracht, Klant, ContractOptie, FactuurOptie, VerplaatsExtra } from './types'
import { zoekVeld } from '@/lib/zoekveld'
import { ReminderSettings } from '@/components/admin/projecten/instellingen-per-bedrijf'

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

const WEERGAVE_SLEUTEL = 'ngm-opdrachten-weergave'

/**
 * Projecten: één overzicht voor nieuwe leads en lopende projecten, als bord of
 * als lijst. Eén kaart per project, ook meerdere per klant. Opvolging →
 * Offerte gestuurd → Contract verstuurd → Contract getekend → In uitvoering →
 * Afgerond, of Verloren. Een contract opmaken, laten tekenen en volledig
 * factureren schuiven de kaart vanzelf door; In uitvoering zet je zelf.
 */
export function OpdrachtenClient() {
  const [rijen, setRijen] = useState<KaartOpdracht[]>([])
  const [klanten, setKlanten] = useState<Klant[]>([])
  const [namen, setNamen] = useState<string[]>([])
  const [contracten, setContracten] = useState<ContractOptie[]>([])
  const [facturen, setFacturen] = useState<FactuurOptie[]>([])
  const [ik, setIk] = useState<string | null>(null)
  const [hint, setHint] = useState<string | null>(null)
  const [laden, setLaden] = useState(true)

  const [q, setQ] = useState('')
  const [wie, setWie] = useState('')
  const [dienst, setDienst] = useState<DienstKey | 'geen' | ''>('')
  const [periodeSoort, setPeriodeSoort] = useState<Periode['soort']>('alles')
  const [jaar, setJaar] = useState(new Date().getFullYear())
  const [maand, setMaand] = useState(new Date().getMonth() + 1)
  const [kwartaal, setKwartaal] = useState<1 | 2 | 3 | 4>((Math.floor(new Date().getMonth() / 3) + 1) as 1 | 2 | 3 | 4)
  const [klantFilter, setKlantFilter] = useState('')
  const [bedrijf, setBedrijf] = useState<Bedrijf | ''>('')
  const [waardeSchijf, setWaardeSchijf] = useState('alle')
  const [archief, setArchief] = useState<{ op: string | null } | null>(null)
  const [instellingen, setInstellingen] = useState(false)
  const [weergave, setWeergave] = useState<'bord' | 'lijst'>('bord')

  const [venster, setVenster] = useState<{ id: string | null; kolom: KolomKey } | null>(null)
  const [vraag, setVraag] = useState<{ id: string; soort: VerplaatsSoort; doel: KolomKey } | null>(null)
  const [aanvullen, setAanvullen] = useState(false)
  const [bannerWeg, setBannerWeg] = useState(false)

  useEffect(() => {
    try { const w = localStorage.getItem(WEERGAVE_SLEUTEL); if (w === 'lijst' || w === 'bord') setWeergave(w) } catch { /* geen opslag: bord */ }
    try { if (sessionStorage.getItem('ngm-opdrachten-aanvullen-weg') === '1') setBannerWeg(true) } catch { /* niet erg */ }
  }, [])
  const kiesWeergave = (w: 'bord' | 'lijst') => { setWeergave(w); try { localStorage.setItem(WEERGAVE_SLEUTEL, w) } catch { /* niet erg */ } }

  const laad = useCallback(async (o?: { stil?: boolean }) => {
    if (!o?.stil) setLaden(true)
    try {
      const res = await fetch('/api/admin/opdrachten', { cache: 'no-store' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setRijen(j.opdrachten ?? [])
      setKlanten(j.klanten ?? [])
      setNamen(j.verantwoordelijken ?? [])
      setContracten(j.contracten ?? [])
      setFacturen(j.facturen ?? [])
      setIk(j.ik ?? null)
      setHint(j.hint ?? null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [])
  useEffect(() => { void laad() }, [laad])
  // Het archief van de oude pipeline (enkel zichtbaar voor admins).
  useEffect(() => {
    fetch('/api/admin/opdrachten/pipeline-archief?info=1', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null)).then((j) => setArchief(j?.archief ?? null)).catch(() => setArchief(null))
  }, [])

  // Deeplink: /admin/opdrachten?opdracht=<id> opent die kaart.
  useEffect(() => {
    if (laden) return
    try {
      const id = new URLSearchParams(window.location.search).get('opdracht')
      if (id && rijen.some((r) => r.id === id)) setVenster({ id, kolom: 'potentieel' })
    } catch { /* niets */ }
    // enkel bij de eerste keer laden
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [laden])

  const periode: Periode = periodeSoort === 'alles' ? { soort: 'alles' } : periodeSoort === 'jaar' ? { soort: 'jaar', jaar } : periodeSoort === 'maand' ? { soort: 'maand', jaar, maand } : { soort: 'kwartaal', jaar, kwartaal }
  const jaren = useMemo(() => {
    const nu = new Date().getFullYear()
    const min = Math.min(nu, ...rijen.map((o) => Number(String(o.datum ?? o.created_at).slice(0, 4))).filter((j) => j > 2000))
    return Array.from({ length: nu - min + 2 }, (_, i) => nu + 1 - i)
  }, [rijen])
  const klantNamen = useMemo(() => [...new Set(rijen.map((o) => o.klant_naam).filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, 'nl')), [rijen])

  const zichtbaar = useMemo(() => {
    const naald = q.trim().toLowerCase()
    return rijen
      .filter((o) => inPeriode(o.datum ?? o.created_at, periode))
      .filter((o) => !klantFilter || o.klant_naam === klantFilter)
      .filter((o) => !bedrijf || (o.merk ?? 'nextgenmedia') === bedrijf)
      .filter((o) => inWaardeSchijf(o.waarde, waardeSchijf))
      .filter((o) => !wie || (wie === '-' ? !o.verantwoordelijke : o.verantwoordelijke === wie))
      .filter((o) => !dienst || (dienst === 'geen' ? o.diensten.length === 0 : o.diensten.some((d) => dienstInfo(d).key === dienst)))
      .filter((o) => !naald || [o.titel, o.omschrijving, o.klant_naam, o.contract?.title, o.verantwoordelijke, o.laatste_notitie?.tekst, ...o.diensten.map((d) => dienstInfo(d).label)]
        .some((v) => (v ?? '').toLowerCase().includes(naald)))
      .sort(sorteerInKolom)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rijen, q, wie, dienst, periodeSoort, jaar, maand, kwartaal, klantFilter, bedrijf, waardeSchijf])

  const open = useMemo(() => {
    const lopend = zichtbaar.filter((o) => !['afgerond', 'stopgezet'].includes(kolomVan(o.status)))
    const gewonnen = zichtbaar.filter((o) => kolomVan(o.status) === 'afgerond')
    return { aantal: lopend.length, waarde: lopend.reduce((t, o) => t + (o.waarde ?? 0), 0), gewonnen: gewonnen.reduce((t, o) => t + (o.waarde ?? 0), 0) }
  }, [zichtbaar])
  const onvolledig = rijen.filter((o) => kolomVan(o.status) !== 'stopgezet' && (o.diensten.length === 0 || !projectVerantwoordelijke(o.verantwoordelijke))).length

  /** Status zetten: meteen tonen, bij een fout terugdraaien. Daarna stil herladen (tijdlijn, facturatie, automatische stappen). */
  const zetStatus = useCallback(async (o: KaartOpdracht, status: OpdrachtStatus, extra: VerplaatsExtra = {}): Promise<boolean> => {
    const vorige = rijen
    setRijen((p) => p.map((x) => (x.id === o.id ? {
      ...x, status, kolom: kolomVan(status), status_bron: 'handmatig', status_gewijzigd_op: new Date().toISOString(),
      ...(extra.offerte_via !== undefined ? { offerte_via: extra.offerte_via } : {}),
      ...(extra.offerte_op !== undefined ? { offerte_op: extra.offerte_op } : {}),
      ...(extra.stop_reden !== undefined ? { stop_reden: extra.stop_reden } : {}),
    } : x)))
    try {
      const body: Record<string, unknown> = { id: o.id, status }
      for (const [k, v] of Object.entries(extra)) if (v !== undefined) body[k] = v
      const res = await fetch('/api/admin/opdrachten', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      void laad({ stil: true })
      return true
    } catch (e) {
      setRijen(vorige)
      toast.error(e instanceof Error ? e.message : 'Verplaatsen mislukt')
      return false
    }
  }, [rijen, laad])

  const verplaats = useCallback((o: KaartOpdracht, doel: KolomKey) => {
    if (kolomVan(o.status) === doel) return
    const soort = vraagBijVerplaatsen(o, doel)
    if (soort) setVraag({ id: o.id, soort, doel })
    else void zetStatus(o, statusVoorKolom(o.status, doel)).then((ok) => { if (ok) toast.success(`Naar ${kolomInfo(doel).label}`) })
  }, [zetStatus])

  const verwijder = async (o: KaartOpdracht) => {
    if (!confirm(`"${o.titel}" verwijderen?\n\nGaat het project niet door, zet de kaart dan op Verloren: zo blijft ze terugvindbaar. Verwijderen haalt ook alle notities weg.`)) return
    try {
      const res = await fetch(`/api/admin/opdrachten?id=${o.id}`, { method: 'DELETE' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setRijen((p) => p.filter((x) => x.id !== o.id))
      setVenster(null)
      toast.success('Verwijderd.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') }
  }

  const vensterKaart = venster?.id ? rijen.find((r) => r.id === venster.id) ?? null : null
  const vraagKaart = vraag ? rijen.find((r) => r.id === vraag.id) ?? null : null
  const chip = (actief: boolean) => `text-xs font-medium px-2.5 py-1 rounded-lg border transition-colors whitespace-nowrap ${actief ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'}`
  const kiezer = 'text-[13px] border border-gray-200 rounded-lg px-2.5 py-1.5 bg-white text-gray-700'
  const filtersActief = !!(q || wie || dienst || klantFilter || bedrijf || waardeSchijf !== 'alle' || periodeSoort !== 'alles')
  const wisFilters = () => { setQ(''); setWie(''); setDienst(''); setKlantFilter(''); setBedrijf(''); setWaardeSchijf('alle'); setPeriodeSoort('alles') }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold tracking-tight flex items-center gap-2"><KanbanSquare className="h-5 w-5 text-gray-500" />Projecten</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Leads en projecten in één overzicht. {open.aantal} lopend · {formatEuro(open.waarde)} open{open.gewonnen ? ` · ${formatEuro(open.gewonnen)} afgerond` : ''} (excl. btw)
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {archief && (
            <a href="/api/admin/opdrachten/pipeline-archief" className="btn-secondary text-sm" title={`Excel met alle leads van de oude pipeline${archief.op ? ` (${new Date(archief.op).toLocaleDateString('nl-BE')})` : ''}`}>
              <FileSpreadsheet className="h-4 w-4" /><span className="hidden sm:inline">Oude pipeline</span>
            </a>
          )}
          <button type="button" onClick={() => setInstellingen(true)} className="btn-secondary text-sm" title="ClickUp-lijsten, meldingen en herinneringsmail per bedrijf"><Settings2 className="h-4 w-4" /><span className="hidden sm:inline">Instellingen</span></button>
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5" role="group" aria-label="Weergave">
            <button type="button" onClick={() => kiesWeergave('bord')} aria-pressed={weergave === 'bord'} className={`text-xs font-medium px-2.5 py-1.5 rounded-md flex items-center gap-1 ${weergave === 'bord' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}><LayoutGrid className="h-3.5 w-3.5" />Bord</button>
            <button type="button" onClick={() => kiesWeergave('lijst')} aria-pressed={weergave === 'lijst'} className={`text-xs font-medium px-2.5 py-1.5 rounded-md flex items-center gap-1 ${weergave === 'lijst' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}><List className="h-3.5 w-3.5" />Lijst</button>
          </div>
          <button type="button" onClick={() => setVenster({ id: null, kolom: 'potentieel' })} className="btn-primary text-sm"><Plus className="h-4 w-4" />Nieuw project</button>
        </div>
      </div>

      {hint && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{hint}</p>}

      {onvolledig > 0 && !laden && !bannerWeg && (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-lg border border-gray-200 bg-white px-3 py-2">
          <p className="text-[13px] text-gray-700"><b>{onvolledig}</b> kaart{onvolledig === 1 ? '' : 'en'} zonder dienst of verantwoordelijke.</p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setAanvullen(true)} className="btn-secondary text-xs"><Sparkles className="h-3.5 w-3.5" />Aanvullen</button>
            <button type="button" onClick={() => { setBannerWeg(true); try { sessionStorage.setItem('ngm-opdrachten-aanvullen-weg', '1') } catch { /* niet erg */ } }}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-black" aria-label="Melding verbergen" title="Verbergen"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {/* Filters: zoeken, periode, klant, bedrijf, waarde, verantwoordelijke en dienst. */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="relative flex-1 min-w-[12rem] sm:flex-none">
            <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input {...zoekVeld()} className="input-base !py-1.5 pl-8 sm:w-64 text-[13px]" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek op klant, project, notitie…" aria-label="Zoeken" />
          </div>
          <select className={kiezer} value={periodeSoort} onChange={(e) => setPeriodeSoort(e.target.value as Periode['soort'])} aria-label="Periode">
            <option value="alles">Alle periodes</option>
            <option value="maand">Maand</option>
            <option value="kwartaal">Kwartaal</option>
            <option value="jaar">Jaar</option>
          </select>
          {periodeSoort === 'maand' && (
            <select className={kiezer} value={maand} onChange={(e) => setMaand(Number(e.target.value))} aria-label="Maand">
              {MAANDEN.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          )}
          {periodeSoort === 'kwartaal' && (
            <select className={kiezer} value={kwartaal} onChange={(e) => setKwartaal(Number(e.target.value) as 1 | 2 | 3 | 4)} aria-label="Kwartaal">
              {[1, 2, 3, 4].map((k) => <option key={k} value={k}>Q{k}</option>)}
            </select>
          )}
          {periodeSoort !== 'alles' && (
            <select className={kiezer} value={jaar} onChange={(e) => setJaar(Number(e.target.value))} aria-label="Jaar">
              {jaren.map((j) => <option key={j} value={j}>{j}</option>)}
            </select>
          )}
          <select className={`${kiezer} max-w-[12rem]`} value={klantFilter} onChange={(e) => setKlantFilter(e.target.value)} aria-label="Klant">
            <option value="">Alle klanten</option>
            {klantNamen.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <select className={kiezer} value={bedrijf} onChange={(e) => setBedrijf(e.target.value as Bedrijf | '')} aria-label="Bedrijf">
            <option value="">Alle bedrijven</option>
            {BEDRIJVEN.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
          </select>
          <select className={kiezer} value={waardeSchijf} onChange={(e) => setWaardeSchijf(e.target.value)} aria-label="Waarde">
            {WAARDE_SCHIJVEN.map((w) => <option key={w.key} value={w.key}>{w.label}</option>)}
          </select>
          <select className={kiezer} value={wie} onChange={(e) => setWie(e.target.value)} aria-label="Verantwoordelijke">
            <option value="">Iedereen</option>
            {namen.map((n) => <option key={n} value={n}>{n}</option>)}
            <option value="-">Zonder verantwoordelijke</option>
          </select>
          {filtersActief && (
            <button type="button" onClick={wisFilters} className="text-xs text-gray-600 hover:text-black inline-flex items-center gap-1 px-1"><X className="h-3.5 w-3.5" />Wissen</button>
          )}
          <span className="text-xs text-gray-500 ml-auto">{zichtbaar.length} van {rijen.length}</span>
        </div>
        <div className="flex items-center gap-1 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
          <button type="button" onClick={() => setDienst('')} className={chip(!dienst)}>Alle diensten</button>
          {DIENSTEN.map((d) => (
            <button key={d.key} type="button" onClick={() => setDienst(dienst === d.key ? '' : (d.key as DienstKey))} className={`${chip(dienst === d.key)} inline-flex items-center gap-1.5`}>
              <span className="h-2 w-2 rounded-full ring-1 ring-black/10" style={{ background: d.rand }} />{d.label}
            </button>
          ))}
          <button type="button" onClick={() => setDienst(dienst === 'geen' ? '' : 'geen')} className={chip(dienst === 'geen')}>Zonder dienst</button>
        </div>
      </div>

      {laden && rijen.length === 0 ? (
        <div className="py-16 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : weergave === 'bord' ? (
        <KanbanBord kaarten={zichtbaar} laden={laden}
          onOpen={(o) => setVenster({ id: o.id, kolom: kolomVan(o.status) })}
          onVerplaats={verplaats}
          onNieuw={(k) => setVenster({ id: null, kolom: k })} />
      ) : (
        <Lijst kaarten={zichtbaar} onOpen={(o) => setVenster({ id: o.id, kolom: kolomVan(o.status) })} />
      )}

      {venster && (venster.id === null || vensterKaart) && (
        <OpdrachtVenster
          key={venster.id ?? `nieuw-${venster.kolom}`}
          o={vensterKaart}
          nieuwKolom={venster.kolom}
          klanten={klanten} contracten={contracten} facturen={facturen} namen={namen} ik={ik}
          onClose={() => setVenster(null)}
          onOpgeslagen={(id) => { setVenster((v) => (v ? { ...v, id } : v)); void laad({ stil: true }) }}
          onVerplaats={verplaats}
          onStap={(o, s) => void zetStatus(o, s)}
          onVerwijder={verwijder}
          onVernieuw={() => void laad({ stil: true })}
          onKlantNieuw={(k) => setKlanten((p) => [...p, k].sort((a, b) => a.naam.localeCompare(b.naam, 'nl')))}
        />
      )}

      {vraag && vraagKaart && (
        <VerplaatsDialoog o={vraagKaart} soort={vraag.soort} doel={vraag.doel} contracten={contracten}
          onClose={() => setVraag(null)}
          onBevestig={async (status, extra) => {
            const ok = await zetStatus(vraagKaart, status, extra)
            if (ok) toast.success(`Naar ${kolomInfo(kolomVan(status)).label}`)
            return ok
          }} />
      )}

      {instellingen && <ReminderSettings onClose={() => setInstellingen(false)} />}
      {aanvullen && <AanvullenDialoog kaarten={rijen.filter((o) => kolomVan(o.status) !== 'stopgezet')} onClose={() => setAanvullen(false)} onKlaar={() => { setAanvullen(false); void laad({ stil: true }) }} />}
    </div>
  )
}

/** Compacte lijst, per fase gegroepeerd. Zelfde kaartvenster als het bord. */
function Lijst({ kaarten, onOpen }: { kaarten: KaartOpdracht[]; onOpen: (o: KaartOpdracht) => void }) {
  if (!kaarten.length) return <div className="card-base text-center py-12 text-sm text-gray-500">Niets gevonden met deze filters.</div>
  return (
    <div className="space-y-5">
      {KOLOMMEN.map((kol) => {
        const lijst = kaarten.filter((o) => kolomVan(o.status) === kol.key)
        if (!lijst.length) return null
        return (
          <section key={kol.key}>
            <div className="flex items-center gap-2 mb-2">
              <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${kol.label_kleur}`}>{kol.label}</span>
              <span className="text-xs text-gray-500">{lijst.length} · {formatEuro(lijst.reduce((t, o) => t + (o.waarde ?? 0), 0))}</span>
            </div>
            <ul className="space-y-1.5">
              {lijst.map((o) => {
                const kleur = kaartKleur(o.diensten)
                return (
                  <li key={o.id}>
                    <button type="button" onClick={() => onOpen(o)} className="w-full text-left card-base p-3 flex items-center gap-3 hover:shadow-md transition-shadow">
                      <span className="h-10 w-2 rounded-full shrink-0 border" style={{ background: kleur.achtergrond, borderColor: kleur.rand }} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold text-sm truncate">{o.klant_naam || 'Geen klant'}</span>
                        <span className="block text-xs text-gray-600 truncate">
                          {o.diensten.length > 0 && <span className="font-medium text-gray-800">{o.diensten.map((d) => dienstInfo(d).label).join(', ')}</span>}
                          {o.diensten.length > 0 && o.titel ? ' · ' : ''}{o.titel}
                        </span>
                      </span>
                      <span className="hidden md:block text-xs text-gray-500 shrink-0 w-28 truncate">{projectVerantwoordelijke(o.verantwoordelijke) ?? <span className="text-amber-700">Geen verantwoordelijke</span>}</span>
                      <span className="hidden sm:block text-xs text-gray-500 shrink-0">{stapLabel(o.status)}</span>
                      <span className="text-right shrink-0">
                        <span className="block text-sm font-semibold tabular-nums">{o.waarde !== null && o.waarde !== undefined ? formatEuro(o.waarde) : '—'}</span>
                        {!!o.facturatie?.gefactureerd && <span className="block text-[11px] text-gray-500 tabular-nums">gefactureerd {formatEuro(o.facturatie.gefactureerd)}</span>}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}
    </div>
  )
}
