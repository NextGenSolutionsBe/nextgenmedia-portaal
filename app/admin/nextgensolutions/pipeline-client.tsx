'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertTriangle, ArrowRight, CalendarClock, Check, Plus, Search, X } from 'lucide-react'
import { zoekVeld } from '@/lib/zoekveld'
import {
  FASES, cijfersVoor, dealWaarde, isOpen, periodeVan, sorteerKolom, volgendeOpvolging, wanneer, zoekDeal, isOpvolgFase, vervolgVan, vervolgOntbreekt, leesChecklist, AUDIT_STAPPEN,
  type Deal, type Fase,
} from '@/lib/ngs/model'
import type { NgsData, Vervolg } from '@/lib/ngs/server'
import { DealVenster, VerplaatsVenster } from './deal-venster'
import { FASE_STIJL, Kop, dagKort, eur, post, tijdstip } from './ui'
import { PersoonKnop } from '@/components/admin/persoon-foto'

type Open = { soort: 'deal'; deal: Deal | null } | { soort: 'verplaats'; deal: Deal; naar: Fase }
/** Closed won/lost: standaard enkel de laatste 90 dagen op het bord (de cijfers tonen alles). */
const RECENT_DAGEN = 90

const initialen = (naam: string | null) => (naam ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map((x) => x[0]!.toUpperCase()).join('') || '?'

/**
 * De pipeline van NextGenSolutions (nieuwe werking, 28 nov 2026): Afspraak →
 * Voorstel → Opvolgen voorstel → Audit → Opvolgen rapport → Closed Won / Lost.
 * Slepen tussen kolommen (computer) of de knop op de kaart (gsm). Naar Voorstel
 * = de vervolgafspraak, naar Audit = processen, prijs en data, opvolgen = een taak.
 */
export function PipelineClient({ begin, vandaag, openDeal }: { begin: NgsData; vandaag: string; openDeal: string | null }) {
  const router = useRouter()
  const [data, setData] = useState(begin)
  const [zoek, setZoek] = useState('')
  const [wie, setWie] = useState<string | null>(null)
  const [mobiel, setMobiel] = useState<Fase>('afspraak')
  const [open, setOpen] = useState<Open | null>(() => {
    const d = openDeal ? begin.deals.find((x) => x.id === openDeal) : null
    return d ? { soort: 'deal', deal: d } : null
  })
  const [sleep, setSleep] = useState<string | null>(null)
  const [boven, setBoven] = useState<Fase | null>(null)
  const [alles, setAlles] = useState<Record<string, boolean>>({})

  const herlaad = useCallback(async (): Promise<NgsData | null> => {
    const r = await fetch('/api/admin/nextgensolutions', { cache: 'no-store' })
    const j = await r.json().catch(() => null)
    if (!r.ok || !j) return null
    setData(j as NgsData)
    return j as NgsData
  }, [])
  // Terug van de Meeting Inplanner (nieuw tabblad): de vervolgafspraak meteen tonen.
  useEffect(() => { const f = () => { herlaad() }; window.addEventListener('focus', f); return () => window.removeEventListener('focus', f) }, [herlaad])
  // Het venster volgt de verse gegevens van de deal.
  useEffect(() => {
    setOpen((o) => (o?.soort === 'deal' && o.deal ? { soort: 'deal', deal: data.deals.find((d) => d.id === o.deal!.id) ?? o.deal } : o))
  }, [data])
  // De link uit ClickUp (?deal=…) weghalen zodra het venster dicht is.
  useEffect(() => { if (!open && openDeal) router.replace('/admin/nextgensolutions', { scroll: false }) }, [open, openDeal, router])

  const klaar = (m: string, nieuw?: { id: string; fase: Fase }) => {
    if (m) toast.success(m)
    setOpen(null)
    herlaad().then((vers) => {
      // Nieuwe deal meteen in Opvolgen: dan nu zeggen wanneer.
      const x = nieuw?.fase === 'opvolgen' ? vers?.deals.find((y) => y.id === nieuw.id) : null
      if (x) setOpen({ soort: 'verplaats', deal: x, naar: 'opvolgen' })
    })
  }

  const verplaats = async (d: Deal, naar: Fase) => {
    if (d.fase === naar) return
    setOpen({ soort: 'verplaats', deal: d, naar })
  }

  const opvolging = useMemo(() => volgendeOpvolging(data.taken), [data.taken])
  const namen = useMemo(() => {
    const s = new Set<string>()
    if (data.ik) s.add(data.ik.split(' ')[0])
    for (const n of ['Marco', 'Bram', 'Chiara']) s.add(n)
    for (const d of data.deals) if (d.verantwoordelijke) s.add(d.verantwoordelijke)
    return Array.from(s)
  }, [data])
  const zichtbaar = useMemo(() => data.deals.filter((d) => zoekDeal(d, zoek) && (!wie || d.verantwoordelijke === wie)), [data.deals, zoek, wie])
  const grens = new Date(Date.parse(`${vandaag}T12:00:00Z`) - RECENT_DAGEN * 86_400_000).toISOString().slice(0, 10)
  const kolom = (f: Fase) => {
    const l = sorteerKolom(zichtbaar, f, opvolging)
    if ((f === 'won' || f === 'lost') && !alles[f]) return { toon: l.filter((d) => (d.gewonnen_op ?? d.verloren_op ?? '') >= grens), ouder: l.filter((d) => (d.gewonnen_op ?? d.verloren_op ?? '') < grens).length }
    return { toon: l, ouder: 0 }
  }

  const deze = cijfersVoor(data.deals, periodeVan('maand', vandaag.slice(0, 7)))
  const opvolgStand = data.deals.filter((d) => isOpvolgFase(d.fase)).reduce((s, d) => {
    const o = opvolging.get(d.id)
    if (!o) s.zonder++
    else if (o < vandaag) s.telaat++
    else if (o === vandaag) s.vandaag++
    return s
  }, { telaat: 0, vandaag: 0, zonder: 0 })

  return (
    <div className="space-y-5 animate-fade-in">
      <Kop actief="pipeline" titel="Pipeline"
        sub={(() => { const n = data.deals.filter((d) => isOpen(d.fase)).length; return `${eur(deze.pipelineWaarde)} open · ${n} ${n === 1 ? 'deal' : 'deals'}` })()}
        rechts={<button type="button" onClick={() => setOpen({ soort: 'deal', deal: null })} className="btn-primary text-sm"><Plus className="h-4 w-4" />Klant</button>} />

      {!data.klaar && <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">De databank is nog niet klaar voor de pipeline (migratie ontbreekt).</div>}

      {/* Kort overzicht */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <Tegel label="Open pipeline" waarde={eur(deze.pipelineWaarde)} sub={`gewogen ${eur(deze.gewogen)}`} />
        <Tegel label="Gewonnen deze maand" waarde={eur(deze.gewonnen.waarde)} sub={`${deze.gewonnen.aantal} ${deze.gewonnen.aantal === 1 ? 'deal' : 'deals'}`} />
        <Tegel label="Opvolgen" waarde={String(opvolgStand.telaat + opvolgStand.vandaag)} sub={opvolgStand.telaat ? `${opvolgStand.telaat} te laat` : opvolgStand.vandaag ? 'vandaag' : 'niets voor vandaag'} rood={opvolgStand.telaat > 0} />
        <Tegel label="Win rate deze maand" waarde={deze.winrate === null ? '—' : `${Math.round(deze.winrate * 100)}%`} sub={`${deze.gewonnen.aantal} won · ${deze.verloren} lost`} />
      </div>

      {/* Zoeken en wie */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="h-4 w-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input {...zoekVeld()} className="input-base text-sm pl-9" placeholder="Zoek bedrijf, contact of info" value={zoek} onChange={(e) => setZoek(e.target.value)} aria-label="Zoek een deal" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          <button type="button" onClick={() => setWie(null)} aria-pressed={wie === null}
            className={`px-2.5 py-1 rounded-full text-xs border ${wie === null ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'}`}>Iedereen</button>
          {namen.map((n) => <PersoonKnop key={n} naam={n} klein rol="button" aan={wie === n} onClick={() => setWie(n)} />)}
        </div>
      </div>

      {/* Gsm: één fase tegelijk */}
      <div className="lg:hidden -mx-1 overflow-x-auto">
        <div className="flex gap-1.5 px-1 w-max">
          {FASES.map((f) => {
            const n = kolom(f.key).toon.length
            return (
              <button key={f.key} type="button" onClick={() => setMobiel(f.key)} aria-pressed={mobiel === f.key}
                className={`px-3 py-1.5 rounded-full text-sm border inline-flex items-center gap-1.5 ${mobiel === f.key ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700'}`}>
                <span className={`h-1.5 w-1.5 rounded-full ${FASE_STIJL[f.key].stip}`} />{f.kort}<span className={mobiel === f.key ? 'text-white/70' : 'text-gray-400'}>{n}</span>
              </button>
            )
          })}
        </div>
      </div>
      <div className="lg:hidden">
        <Kolom fase={mobiel} {...kolom(mobiel)} vandaag={vandaag} opvolging={opvolging} sleep={null} boven={false}
          onOpen={(d) => setOpen({ soort: 'deal', deal: d })} onVerplaats={verplaats} onAlles={() => setAlles((a) => ({ ...a, [mobiel]: !a[mobiel] }))} alles={!!alles[mobiel]} vervolg={data.vervolg ?? {}} />
      </div>

      {/* Computer: alle fases naast elkaar, slepen kan */}
      <div className="hidden lg:flex gap-3 items-start overflow-x-auto pb-2">
        {FASES.map((f) => (
          <div key={f.key} className="w-[236px] shrink-0"
            onDragOver={(e) => { if (sleep) { e.preventDefault(); setBoven(f.key) } }}
            onDragLeave={() => setBoven((b) => (b === f.key ? null : b))}
            onDrop={(e) => { e.preventDefault(); const d = data.deals.find((x) => x.id === sleep); setSleep(null); setBoven(null); if (d) verplaats(d, f.key) }}>
            <Kolom fase={f.key} {...kolom(f.key)} vandaag={vandaag} opvolging={opvolging} sleep={sleep} boven={boven === f.key}
              onOpen={(d) => setOpen({ soort: 'deal', deal: d })} onVerplaats={verplaats} onSleep={setSleep}
              onAlles={() => setAlles((a) => ({ ...a, [f.key]: !a[f.key] }))} alles={!!alles[f.key]} vervolg={data.vervolg ?? {}} />
          </div>
        ))}
      </div>

      {open?.soort === 'deal' && (
        <DealVenster deal={open.deal} ik={data.ik ? data.ik.split(' ')[0] : null} namen={namen} onSluit={() => setOpen(null)} onKlaar={klaar}
          onVernieuw={() => { herlaad() }} onVerplaats={verplaats} vervolg={open.deal ? data.vervolg?.[open.deal.id] ?? null : null} verkoop={data.verkoop} />
      )}
      {open?.soort === 'verplaats' && <VerplaatsVenster deal={open.deal} naar={open.naar} verkoop={data.verkoop} onSluit={() => setOpen(null)} onKlaar={(m) => klaar(m)} />}
    </div>
  )
}

function Tegel({ label, waarde, sub, rood }: { label: string; waarde: string; sub: string; rood?: boolean }) {
  return (
    <div className="card-base !p-3 sm:!p-4 min-w-0">
      <div className="text-[11px] text-gray-500 truncate">{label}</div>
      <div className={`text-lg sm:text-2xl font-semibold tabular-nums mt-0.5 ${rood ? 'text-red-600' : 'text-gray-900'}`}>{waarde}</div>
      <div className={`text-[11px] truncate ${rood ? 'text-red-600' : 'text-gray-500'}`}>{sub}</div>
    </div>
  )
}

const VOLGENDE: Partial<Record<Fase, { naar: Fase; label: string }>> = {
  afspraak: { naar: 'voorstel', label: 'Voorstel' },
  voorstel: { naar: 'opvolgen', label: 'Opvolgen' },
  opvolgen: { naar: 'audit', label: 'Audit' },
  audit: { naar: 'opvolgen_rapport', label: 'Rapport opvolgen' },
}

function Kolom({ fase, toon, ouder, vandaag, opvolging, sleep, boven, onOpen, onVerplaats, onSleep, onAlles, alles, vervolg }: {
  fase: Fase; toon: Deal[]; ouder: number; vandaag: string; opvolging: Map<string, string>; sleep: string | null; boven: boolean
  onOpen: (d: Deal) => void; onVerplaats: (d: Deal, naar: Fase) => void; onSleep?: (id: string | null) => void; onAlles: () => void; alles: boolean
  vervolg: Record<string, Vervolg>
}) {
  const f = FASES.find((x) => x.key === fase)!
  const som = toon.reduce((s, d) => s + dealWaarde(d), 0)
  return (
    <section className={`rounded-2xl p-2 transition ${boven ? 'bg-blue-50 ring-2 ring-blue-300' : 'bg-gray-100/70'}`} aria-label={f.label}>
      <div className="flex items-center justify-between gap-2 px-1.5 pt-1 pb-2">
        <span className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${FASE_STIJL[fase].stip}`} />{f.label}<span className="text-gray-400 font-normal">{toon.length}</span></span>
        <span className="text-[11px] text-gray-500 tabular-nums">{eur(som)}</span>
      </div>
      <div className="space-y-2 min-h-[60px]">
        {toon.map((d) => <Kaart key={d.id} d={d} vandaag={vandaag} opvolging={opvolging.get(d.id) ?? null} vervolg={vervolg[d.id] ?? null} sleept={sleep === d.id} onOpen={() => onOpen(d)} onVerplaats={(n) => onVerplaats(d, n)} onSleep={onSleep} />)}
        {toon.length === 0 && <p className="text-xs text-gray-400 px-2 py-3 text-center">{sleep ? 'Sleep hierheen' : fase === 'won' || fase === 'lost' ? `Niets de laatste ${RECENT_DAGEN} dagen` : 'Leeg'}</p>}
      </div>
      {(ouder > 0 || alles) && (fase === 'won' || fase === 'lost') && (
        <button type="button" onClick={onAlles} className="mt-2 w-full text-xs text-gray-500 hover:text-gray-900 py-1">{alles ? 'Enkel de laatste 90 dagen' : `+ ${ouder} ouder`}</button>
      )}
    </section>
  )
}

function Kaart({ d, vandaag, opvolging, vervolg, sleept, onOpen, onVerplaats, onSleep }: {
  d: Deal; vandaag: string; opvolging: string | null; vervolg: Vervolg | null; sleept: boolean; onOpen: () => void; onVerplaats: (naar: Fase) => void; onSleep?: (id: string | null) => void
}) {
  const vv = vervolgVan(d, vervolg)
  const geenVervolg = vervolgOntbreekt(d, vv, new Date().toISOString())
  const lijst = leesChecklist(d.audit_checklist)
  const klaarStappen = AUDIT_STAPPEN.filter((s) => lijst[s.key]).length
  const volgende = VOLGENDE[d.fase]
  const w = opvolging ? wanneer(opvolging, vandaag) : null
  const bedragen = [d.waarde_eenmalig ? eur(d.waarde_eenmalig) : null, d.waarde_maandelijks ? `${eur(d.waarde_maandelijks)}/m` : null].filter(Boolean).join(' + ')
  return (
    <article draggable={!!onSleep} onDragStart={(e) => { e.dataTransfer.effectAllowed = 'move'; onSleep?.(d.id) }} onDragEnd={() => onSleep?.(null)}
      className={`rounded-xl bg-white border border-gray-200/80 shadow-sm hover:shadow transition ${sleept ? 'opacity-40' : ''} ${onSleep ? 'cursor-grab active:cursor-grabbing' : ''}`}>
      <button type="button" onClick={onOpen} className="w-full text-left p-3 space-y-1.5">
        <div className="flex items-start gap-2">
          <span className="font-semibold text-sm text-gray-900 flex-1 min-w-0 break-words">{d.bedrijf}</span>
          {d.verantwoordelijke && <span title={d.verantwoordelijke} className="h-6 w-6 shrink-0 rounded-full bg-gray-100 text-[10px] font-semibold text-gray-700 flex items-center justify-center">{initialen(d.verantwoordelijke)}</span>}
        </div>
        {d.titel && <p className="text-xs text-gray-600 line-clamp-3 whitespace-pre-line break-words">{d.titel}</p>}
        {bedragen && <p className="text-xs font-semibold text-gray-900 tabular-nums">{bedragen}</p>}
        {d.fase === 'afspraak' && (d.afspraak_op
          ? <p className={`text-[11px] inline-flex items-center gap-1 ${d.afspraak_op.slice(0, 10) < vandaag ? 'text-amber-700' : 'text-gray-600'}`}><CalendarClock className="h-3 w-3" />{tijdstip(d.afspraak_op)}</p>
          : <p className="text-[11px] text-gray-400">Nog geen datum</p>)}
        {d.fase === 'voorstel' && (geenVervolg
          ? <p className="text-[11px] font-medium text-amber-800 bg-amber-50 rounded px-1.5 py-0.5 inline-flex items-center gap-1"><AlertTriangle className="h-3 w-3" />Geen vervolgafspraak</p>
          : <p className="text-[11px] text-gray-700 inline-flex items-center gap-1"><CalendarClock className="h-3 w-3" />Vervolgafspraak {tijdstip(vv!)}</p>)}
        {isOpvolgFase(d.fase) && (w
          ? <p className={`text-[11px] font-medium ${w.telaat ? 'text-red-600' : w.vandaag ? 'text-amber-700' : 'text-gray-600'}`}>Opvolgen {w.tekst}{!w.telaat && !w.vandaag ? ` (${dagKort(opvolging!)})` : ''}</p>
          : <p className="text-[11px] text-amber-700">Geen opvolgtaak</p>)}
        {d.fase === 'audit' && <p className="text-[11px] text-blue-900">{d.auditdag_op ? `Auditdag ${dagKort(d.auditdag_op)}` : 'Auditdag?'}{d.presentatie_op ? ` · rapport ${dagKort(d.presentatie_op)}` : ''} · {klaarStappen}/{AUDIT_STAPPEN.length}</p>}
        {d.fase === 'won' && d.gewonnen_op && <p className="text-[11px] text-green-700">Gewonnen {dagKort(d.gewonnen_op)} · {eur(dealWaarde(d))}</p>}
        {d.fase === 'lost' && <p className="text-[11px] text-gray-500 line-clamp-1">{d.verloren_reden}</p>}
      </button>
      {isOpen(d.fase) && (
        <div className="flex gap-1 px-2 pb-2 -mt-0.5">
          {volgende && <button type="button" onClick={() => onVerplaats(volgende.naar)} className="flex-1 h-8 rounded-lg text-[11px] font-medium bg-gray-50 hover:bg-gray-100 text-gray-800 inline-flex items-center justify-center gap-1">{volgende.label}<ArrowRight className="h-3 w-3" /></button>}
          {d.fase === 'opvolgen_rapport' && <button type="button" onClick={() => onVerplaats('won')} className="flex-1 h-8 rounded-lg text-[11px] font-medium bg-green-50 hover:bg-green-100 text-green-800 inline-flex items-center justify-center gap-1"><Check className="h-3 w-3" />Won</button>}
          {isOpvolgFase(d.fase) && <button type="button" onClick={() => onVerplaats('lost')} className="flex-1 h-8 rounded-lg text-[11px] font-medium bg-gray-50 hover:bg-gray-100 text-gray-600 inline-flex items-center justify-center gap-1"><X className="h-3 w-3" />Lost</button>}
        </div>
      )}
    </article>
  )
}

