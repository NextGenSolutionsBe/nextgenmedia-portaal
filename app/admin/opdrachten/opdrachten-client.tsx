'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Plus, Search, ClipboardList, LayoutGrid, List, Sparkles, X } from 'lucide-react'
import {
  KOLOMMEN, kolomInfo, kolomVan, statusVoorKolom, stapLabel, kaartKleur, DIENSTEN, dienstInfo, bronLabel, sorteerInKolom,
  type KolomKey, type DienstKey,
} from '@/lib/opdrachten-kanban'
import type { OpdrachtStatus } from '@/lib/opdrachten'
import { formatEuro } from '@/lib/utils'
import { KanbanBord } from './kanban-bord'
import { OpdrachtVenster } from './opdracht-venster'
import { VerplaatsDialoog, vraagBijVerplaatsen, type VerplaatsSoort } from './verplaats-dialoog'
import { AanvullenDialoog } from './aanvullen-dialoog'
import type { KaartOpdracht, Klant, ContractOptie, FactuurOptie, VerplaatsExtra } from './types'
import { zoekVeld } from '@/lib/zoekveld'

const WEERGAVE_SLEUTEL = 'ngm-opdrachten-weergave'

/**
 * Opdrachten als kanbanbord: één kaart per project, ook meerdere per klant.
 * Van potentiële opdracht tot afgerond (of stopgezet). Contract verstuurd,
 * getekend en volledig gefactureerd schuiven de kaart vanzelf door; In
 * uitvoering zet je zelf.
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
  const [bron, setBron] = useState<'inbound' | 'outbound' | ''>('')
  const [weergave, setWeergave] = useState<'bord' | 'lijst'>('bord')

  const [venster, setVenster] = useState<{ id: string | null; kolom: KolomKey } | null>(null)
  const [vraag, setVraag] = useState<{ id: string; soort: VerplaatsSoort } | null>(null)
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

  const zichtbaar = useMemo(() => {
    const naald = q.trim().toLowerCase()
    return rijen
      .filter((o) => !wie || (wie === '-' ? !o.verantwoordelijke : o.verantwoordelijke === wie))
      .filter((o) => !dienst || (dienst === 'geen' ? o.diensten.length === 0 : o.diensten.includes(dienst)))
      .filter((o) => !bron || o.bron === bron)
      .filter((o) => !naald || [o.titel, o.omschrijving, o.klant_naam, o.contract?.title, o.verantwoordelijke, o.laatste_notitie?.tekst, ...o.diensten.map((d) => dienstInfo(d).label)]
        .some((v) => (v ?? '').toLowerCase().includes(naald)))
      .sort(sorteerInKolom)
  }, [rijen, q, wie, dienst, bron])

  const open = useMemo(() => {
    const lopend = rijen.filter((o) => !['afgerond', 'stopgezet'].includes(kolomVan(o.status)))
    return { aantal: lopend.length, waarde: lopend.reduce((t, o) => t + (o.waarde ?? 0), 0) }
  }, [rijen])
  const onvolledig = rijen.filter((o) => kolomVan(o.status) !== 'stopgezet' && (o.diensten.length === 0 || !o.bron)).length

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
    if (soort) setVraag({ id: o.id, soort })
    else void zetStatus(o, statusVoorKolom(o.status, doel)).then((ok) => { if (ok) toast.success(`Naar ${kolomInfo(doel).label}`) })
  }, [zetStatus])

  const verwijder = async (o: KaartOpdracht) => {
    if (!confirm(`"${o.titel}" verwijderen?\n\nGaat het project niet door, zet de kaart dan op Stopgezet: zo blijft ze terugvindbaar. Verwijderen haalt ook alle notities weg.`)) return
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
  const chip = (actief: boolean) => `text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors whitespace-nowrap ${actief ? 'bg-gray-900 text-white border-gray-900' : 'bg-white border-gray-200 hover:bg-gray-50'}`

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><ClipboardList className="h-6 w-6" />Opdrachten</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Elk project een kaart, ook voor vaste klanten. {open.aantal} lopend · {formatEuro(open.waarde)} excl. btw
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-xl border border-gray-200 bg-white p-0.5" role="group" aria-label="Weergave">
            <button type="button" onClick={() => kiesWeergave('bord')} aria-pressed={weergave === 'bord'} className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1 ${weergave === 'bord' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}><LayoutGrid className="h-3.5 w-3.5" />Bord</button>
            <button type="button" onClick={() => kiesWeergave('lijst')} aria-pressed={weergave === 'lijst'} className={`text-xs font-semibold px-2.5 py-1.5 rounded-lg flex items-center gap-1 ${weergave === 'lijst' ? 'bg-gray-900 text-white' : 'text-gray-600'}`}><List className="h-3.5 w-3.5" />Lijst</button>
          </div>
          <button type="button" onClick={() => setVenster({ id: null, kolom: 'potentieel' })} className="btn-primary text-sm"><Plus className="h-4 w-4" />Nieuwe opdracht</button>
        </div>
      </div>

      {hint && <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">{hint}</p>}

      {onvolledig > 0 && !laden && !bannerWeg && (
        <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-gray-200 bg-white px-4 py-2.5">
          <p className="text-sm text-gray-700"><b>{onvolledig}</b> kaart{onvolledig === 1 ? '' : 'en'} zonder dienst of bron. Vul ze in één keer aan, dan krijgen ze hun kleur.</p>
          <div className="flex items-center gap-1">
            <button type="button" onClick={() => setAanvullen(true)} className="btn-secondary text-sm"><Sparkles className="h-4 w-4" />Kaarten aanvullen</button>
            <button type="button" onClick={() => { setBannerWeg(true); try { sessionStorage.setItem('ngm-opdrachten-aanvullen-weg', '1') } catch { /* niet erg */ } }}
              className="h-9 w-9 rounded-lg flex items-center justify-center text-gray-400 hover:bg-gray-100 hover:text-black" aria-label="Melding verbergen" title="Verbergen"><X className="h-4 w-4" /></button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[12rem] sm:flex-none">
            <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input {...zoekVeld()} className="input-base pl-8 sm:w-72" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek op project, klant, notitie…" aria-label="Zoeken" />
          </div>
          <select className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white" value={wie} onChange={(e) => setWie(e.target.value)} aria-label="Verantwoordelijke">
            <option value="">Iedereen</option>
            {namen.map((n) => <option key={n} value={n}>{n}</option>)}
            <option value="-">Zonder verantwoordelijke</option>
          </select>
          <select className="text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white" value={bron} onChange={(e) => setBron(e.target.value as typeof bron)} aria-label="Bron">
            <option value="">Inbound en outbound</option>
            <option value="inbound">Inbound</option>
            <option value="outbound">Outbound</option>
          </select>
          {(q || wie || dienst || bron) && (
            <button type="button" onClick={() => { setQ(''); setWie(''); setDienst(''); setBron('') }} className="text-xs text-gray-600 hover:text-black inline-flex items-center gap-1"><X className="h-3.5 w-3.5" />Filters wissen</button>
          )}
          <span className="text-xs text-gray-500 ml-auto">{zichtbaar.length} van {rijen.length} kaarten</span>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 -mx-4 px-4 sm:mx-0 sm:px-0">
          <button type="button" onClick={() => setDienst('')} className={chip(!dienst)}>Alle diensten</button>
          {DIENSTEN.map((d) => (
            <button key={d.key} type="button" onClick={() => setDienst(dienst === d.key ? '' : (d.key as DienstKey))} className={`${chip(dienst === d.key)} inline-flex items-center gap-1.5`}>
              <span className="h-2.5 w-2.5 rounded-full border border-black/10" style={{ background: d.achtergrond }} />{d.label}
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
          onKlantNieuw={(k) => setKlanten((p) => [...p, k].sort((a, b) => a.naam.localeCompare(b.naam, 'nl')))}
        />
      )}

      {vraag && vraagKaart && (
        <VerplaatsDialoog o={vraagKaart} soort={vraag.soort} contracten={contracten}
          onClose={() => setVraag(null)}
          onBevestig={async (status, extra) => {
            const ok = await zetStatus(vraagKaart, status, extra)
            if (ok) toast.success(`Naar ${kolomInfo(kolomVan(status)).label}`)
            return ok
          }} />
      )}

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
                          {o.diensten.length > 0 && o.titel ? ' · ' : ''}{o.titel}{o.bron ? ` · ${bronLabel(o.bron)}` : ''}
                        </span>
                      </span>
                      <span className="hidden sm:block text-xs text-gray-500 shrink-0">{stapLabel(o.status)}</span>
                      <span className="text-sm font-semibold tabular-nums shrink-0">{o.waarde !== null && o.waarde !== undefined ? formatEuro(o.waarde) : '—'}</span>
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
