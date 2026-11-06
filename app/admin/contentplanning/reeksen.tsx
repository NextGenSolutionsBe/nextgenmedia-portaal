'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw } from 'lucide-react'
import {
  FASE_KEYS, FASE_LABEL, REEKSEN, DAG_KORT, werkdagenVanMaand, weekdagNr, faseplanVanMaand, segmenten, pasFaseAan, wisselDag, planNaarDagen, reeksPeriodes,
  reeksenVanDag, maandag, plusDagen, maandVan, eersteWerkdag,
  type FaseKey, type FasePlan, type Reeks,
} from '@/lib/contentplanning/model'
import { focusRing } from './bouwstenen'
import { KAART } from './werking'
import type { CpData, Doe } from './types'
import { MAANDEN, maandNaam } from './types'

/**
 * Reeksen — de maand met de fases (en dus de kleuren van de drie reeksen).
 * Aanpassen door te slepen:
 *   · einde of begin van een blok verslepen = langer/korter
 *   · midden van een blok verslepen = het hele blok verschuiven
 *   · klikken = één dag aan/uit
 * Met "Volgende fases schuiven mee" schuift alles wat ná het blok begint mee.
 * Bewaard als Maandplanning-aanpassingen; "Standaard herstellen" zet de maand terug.
 * Onder de tijdlijn: het maandoverzicht met per dag de kleur van de reeks — het
 * volgt het plan live, ook tijdens het slepen.
 */

type Sleep = { fase: FaseKey; modus: 'begin' | 'einde' | 'blok'; oud: [number, number]; startDag: number; basis: FasePlan; dag: number; bewogen: boolean }
const kleurVan = (k: FaseKey, koppeling: Record<string, Reeks>) => (koppeling[k] ? REEKSEN[koppeling[k] - 1].kleur : 'bg-gray-400')
const dagKort = (d: string) => `${DAG_KORT[weekdagNr(d) - 1]} ${Number(d.slice(8))}`
const periodeTekst = (van: string, tot: string) => (van === tot ? dagKort(van) : `${dagKort(van)} – ${dagKort(tot)}`)

export function Reeksen({ data, maand, doe, vandaag, onDag }: { data: CpData; maand: string; doe: Doe; vandaag: string; onDag: (d: string) => void }) {
  const kan = data.kan.beheren
  const koppeling = data.instellingen.fase_reeks
  const wd = useMemo(() => werkdagenVanMaand(maand), [maand])
  const totaal = wd.length
  const basis = useMemo(() => faseplanVanMaand(maand, data.faseAanpassingen), [maand, data.faseAanpassingen])
  const aangepast = wd.some((d) => d in data.faseAanpassingen)
  const [plan, setPlan] = useState<FasePlan>(basis)
  const [meeschuiven, setMeeschuiven] = useState(true)
  const [gekozen, setGekozen] = useState<FaseKey | null>(null)
  const sleep = useRef<Sleep | null>(null)
  useEffect(() => { if (!sleep.current) setPlan(basis) }, [basis])

  // Rijen: per reeks gegroepeerd, binnen de reeks in de gewone volgorde.
  const rijen = useMemo(() => [...FASE_KEYS].sort((a, b) => (koppeling[a] ?? 9) - (koppeling[b] ?? 9) || FASE_KEYS.indexOf(a) - FASE_KEYS.indexOf(b)), [koppeling])
  const periodes = reeksPeriodes(maand, plan, koppeling)

  const bewaar = async (nieuw: FasePlan, vorig: FasePlan, melding: string) => {
    setPlan(nieuw)
    const r = await doe('reeksen.opslaan', { maand, dagen: planNaarDagen(maand, nieuw) }, { stil: true })
    if (!r) { setPlan(vorig); return }
    toast.success(melding, { action: { label: 'Ongedaan maken', onClick: () => { bewaar(vorig, nieuw, 'Teruggezet.') } } })
  }
  const pas = (fase: FaseKey, oud: [number, number], nieuw: [number, number], wat: string) => {
    if (!kan || (oud[0] === nieuw[0] && oud[1] === nieuw[1])) return
    const n = pasFaseAan(plan, fase, oud, nieuw, meeschuiven, totaal)
    bewaar(n, plan, `${FASE_LABEL[fase]}: ${wat}${meeschuiven && nieuw[1] !== oud[1] ? ' · volgende fases schoven mee' : ''}.`)
  }

  // ── Slepen (muis en aanraking): we volgen de pointer over de dagkolommen ──
  const dagOnder = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-dag]') as HTMLElement | null
    return el ? Number(el.dataset.dag) : null
  }
  const begin = (e: React.PointerEvent, fase: FaseKey, dag: number) => {
    if (!kan || e.button !== 0) return
    e.preventDefault()
    const seg = segmenten(plan[fase]).find(([v, t]) => dag >= v && dag <= t)
    const oud: [number, number] = seg ?? [dag, dag]
    const modus: Sleep['modus'] = !seg ? 'einde' : dag === seg[1] ? 'einde' : dag === seg[0] ? 'begin' : 'blok'
    sleep.current = { fase, modus, oud, startDag: dag, basis: plan, dag, bewogen: false }
    setGekozen(fase)
  }
  const nieuwVan = (s: Sleep, dag: number): [number, number] => {
    const d = dag - s.startDag
    if (s.modus === 'einde') return [s.oud[0], Math.max(s.oud[0], dag)]
    if (s.modus === 'begin') return [Math.min(dag, s.oud[1]), s.oud[1]]
    const lengte = s.oud[1] - s.oud[0]
    const v = Math.max(1, Math.min(totaal - lengte, s.oud[0] + d))
    return [v, v + lengte]
  }
  useEffect(() => {
    const beweeg = (e: PointerEvent) => {
      const s = sleep.current; if (!s) return
      const dag = dagOnder(e.clientX, e.clientY); if (dag == null || dag === s.dag) return
      s.dag = dag; s.bewogen = true
      // Een nieuwe (lege) dag "slepen" = het blok vanaf die dag laten lopen.
      const heeft = s.basis[s.fase].includes(s.startDag)
      if (!heeft) { const v = Math.min(s.startDag, dag), t = Math.max(s.startDag, dag); setPlan(pasFaseAan(s.basis, s.fase, [s.startDag, s.startDag], [v, t], false, totaal)); return }
      setPlan(pasFaseAan(s.basis, s.fase, s.oud, nieuwVan(s, dag), meeschuiven, totaal))
    }
    const los = () => {
      const s = sleep.current; if (!s) return
      sleep.current = null
      const heeft = s.basis[s.fase].includes(s.startDag)
      if (!s.bewogen) {
        // Klik = één dag aan/uit.
        const n = wisselDag(s.basis, s.fase, s.startDag)
        bewaar(n, s.basis, `${FASE_LABEL[s.fase]}: ${wd[s.startDag - 1] ? dagKort(wd[s.startDag - 1]) : ''} ${heeft ? 'weggehaald' : 'toegevoegd'}.`)
        return
      }
      if (!heeft) { const v = Math.min(s.startDag, s.dag), t = Math.max(s.startDag, s.dag); bewaar(pasFaseAan(s.basis, s.fase, [s.startDag, s.startDag], [v, t], false, totaal), s.basis, `${FASE_LABEL[s.fase]}: ${periodeTekst(wd[v - 1], wd[t - 1])} toegevoegd.`); return }
      const [v, t] = nieuwVan(s, s.dag)
      if (v === s.oud[0] && t === s.oud[1]) { setPlan(s.basis); return }
      bewaar(pasFaseAan(s.basis, s.fase, s.oud, [v, t], meeschuiven, totaal), s.basis, `${FASE_LABEL[s.fase]}: nu ${periodeTekst(wd[v - 1], wd[t - 1])}${meeschuiven && t !== s.oud[1] ? ' · volgende fases schoven mee' : ''}.`)
    }
    window.addEventListener('pointermove', beweeg)
    window.addEventListener('pointerup', los)
    window.addEventListener('pointercancel', los)
    return () => { window.removeEventListener('pointermove', beweeg); window.removeEventListener('pointerup', los); window.removeEventListener('pointercancel', los) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meeschuiven, totaal, maand, wd])

  const herstel = async () => {
    if (!window.confirm(`De reeksen van ${maandNaam(maand)} terugzetten naar de standaardindeling?`)) return
    const vorig = plan
    const r = await doe('reeksen.herstel', { maand }, { stil: true })
    if (r) toast.success('Standaardindeling hersteld.', { action: { label: 'Ongedaan maken', onClick: () => { bewaar(vorig, basis, 'Teruggezet.') } } })
  }

  const kolommen = `220px repeat(${totaal}, minmax(32px, 1fr))`
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-cp-klein text-cp-zacht">{totaal} werkdagen{aangepast ? ' · aangepast' : ''}</span>
        <div className="flex-1" />
        {kan && (
          <label className="inline-flex items-center gap-2 text-cp-basis font-medium cursor-pointer select-none">
            <input type="checkbox" checked={meeschuiven} onChange={(e) => setMeeschuiven(e.target.checked)} className="h-5 w-5 accent-[var(--cp-klaar)]" />
            Volgende fases schuiven mee
          </label>
        )}
        {kan && aangepast && <button type="button" onClick={herstel} className={`inline-flex items-center gap-2 h-10 px-4 rounded-xl border border-cp-rand bg-cp-vlak text-cp-klein font-semibold hover:border-cp-ink ${focusRing}`}><RotateCcw className="h-4 w-4" />Standaard herstellen</button>}
      </div>

      {/* Wanneer loopt elke reeks? */}
      <div className="grid sm:grid-cols-3 gap-3">
        {REEKSEN.map((r) => {
          const p = periodes[r.nr]
          return (
            <div key={r.nr} className={`${KAART} overflow-hidden`}>
              <div className={`h-2 ${r.kleur}`} />
              <div className={`px-4 py-3 ${r.zacht}`}>
                <div className="text-cp-klein font-semibold">{r.label}</div>
                <div className="text-cp-kop mt-0.5">{p ? <>{periodeTekst(p.van, p.tot)} {MAANDEN[Number(p.tot.slice(5, 7)) - 1]}</> : <span className="text-cp-zacht">—</span>}</div>
                {p && <div className="text-cp-klein text-cp-zacht">{p.dagen} werkdag{p.dagen === 1 ? '' : 'en'}</div>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Tijdlijn (vanaf tablet) */}
      <div className={`hidden md:block ${KAART} overflow-hidden`}>
        <div className="overflow-x-auto">
          <div className="min-w-[860px] select-none">
            <div className="grid border-b border-cp-rand bg-cp-achtergrond" style={{ gridTemplateColumns: kolommen }}>
              <div className="px-4 py-2 text-cp-klein font-semibold text-cp-zacht self-center">Fase</div>
              {wd.map((d, i) => (
                <div key={d} className={`py-2 text-center leading-tight ${d === vandaag ? 'bg-cp-ink text-cp-op-ink' : ''} ${i > 0 && weekdagNr(d) === 1 ? 'border-l border-cp-rand' : ''}`}>
                  <div className="text-[10px] uppercase opacity-60">{DAG_KORT[weekdagNr(d) - 1]}</div>
                  <div className="text-cp-klein font-bold">{Number(d.slice(8))}</div>
                </div>
              ))}
            </div>
            {rijen.map((k) => {
              const segs = segmenten(plan[k])
              const kleur = kleurVan(k, koppeling)
              return (
                <div key={k} className={`grid border-b border-cp-rand last:border-b-0 ${gekozen === k ? 'bg-cp-achtergrond' : ''}`} style={{ gridTemplateColumns: kolommen }}>
                  <button type="button" onClick={() => setGekozen(gekozen === k ? null : k)} aria-pressed={gekozen === k}
                    className={`px-4 py-3 text-left text-cp-basis font-medium flex items-center gap-2.5 ${focusRing}`}>
                    <span className={`h-3 w-3 rounded-full shrink-0 ${kleur}`} /><span className="truncate">{FASE_LABEL[k]}</span>
                  </button>
                  {wd.map((d, i) => {
                    const nr = i + 1
                    const aan = plan[k].includes(nr)
                    const seg = segs.find(([v, t]) => nr >= v && nr <= t)
                    const eerste = seg && seg[0] === nr, laatste = seg && seg[1] === nr
                    return (
                      <div key={d} data-dag={nr} onPointerDown={(e) => begin(e, k, nr)} style={kan ? { touchAction: 'none' } : undefined}
                        title={`${FASE_LABEL[k]} · ${dagKort(d)}`}
                        className={`relative py-3 ${i > 0 && weekdagNr(d) === 1 ? 'border-l border-cp-rand' : ''} ${kan ? (aan ? (laatste || eerste ? 'cursor-ew-resize' : 'cursor-grab') : 'cursor-pointer hover:bg-cp-achtergrond') : ''}`}>
                        {aan && (
                          <div className={`h-7 ${kleur} ${eerste ? 'rounded-l-lg ml-0.5' : ''} ${laatste ? 'rounded-r-lg mr-0.5' : ''} relative`}>
                            {kan && laatste && <span className="absolute right-1 top-1.5 bottom-1.5 w-1 rounded bg-white/80" aria-hidden />}
                            {kan && eerste && !laatste && <span className="absolute left-1 top-1.5 bottom-1.5 w-1 rounded bg-white/80" aria-hidden />}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
        </div>
        {gekozen && <div className="border-t border-cp-rand p-4"><FaseRegel fase={gekozen} plan={plan} wd={wd} kan={kan} koppeling={koppeling} pas={pas} /></div>}
      </div>

      {/* Telefoon: per fase een kaart met knoppen */}
      <div className="md:hidden space-y-3">
        {rijen.map((k) => <div key={k} className={`${KAART} p-4`}><FaseRegel fase={k} plan={plan} wd={wd} kan={kan} koppeling={koppeling} pas={pas} /></div>)}
      </div>

      <MaandOverzicht maand={maand} plan={plan} koppeling={koppeling} vandaag={vandaag} onDag={onDag} />
    </div>
  )
}

/** De hele maand met per dag de kleur van de reeks(en). Volgt het plan live. */
function MaandOverzicht({ maand, plan, koppeling, vandaag, onDag }: { maand: string; plan: FasePlan; koppeling: Record<string, Reeks>; vandaag: string; onDag: (d: string) => void }) {
  const perDag = useMemo(() => {
    const dagen = planNaarDagen(maand, plan)
    return new Map(Object.entries(dagen).map(([d, f]) => [d, reeksenVanDag(f, koppeling)]))
  }, [maand, plan, koppeling])
  const periodes = reeksPeriodes(maand, plan, koppeling)
  const start = maandag(`${maand}-01`)
  const cellen = Array.from({ length: 42 }, (_, i) => plusDagen(start, i))
  // Weken die volledig buiten de maand vallen, weglaten.
  const zichtbaar = cellen.filter((_, i) => cellen.slice(Math.floor(i / 7) * 7, Math.floor(i / 7) * 7 + 7).some((c) => maandVan(c) === maand))
  const label = (d: string) => {
    const uit: string[] = []
    if (d === eersteWerkdag(maand)) uit.push('Maandstart')
    if (periodes[2]?.van === d) uit.push('Start R2')
    if (periodes[3]?.van === d) uit.push('Meetings')
    return uit
  }
  return (
    <section className={`${KAART} p-4 sm:p-5 space-y-4`}>
      <div className="flex items-center gap-x-5 gap-y-2 flex-wrap">
        <h2 className="text-cp-kop capitalize flex-1 min-w-[160px]">{maandNaam(maand)}</h2>
        {REEKSEN.map((r) => <span key={r.nr} className="inline-flex items-center gap-2 text-cp-klein font-medium"><span className={`h-4 w-4 rounded ${r.kleur}`} />{r.kort}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
        {DAG_KORT.map((x) => <div key={x} className="text-center text-cp-klein font-semibold uppercase text-cp-zacht">{x}</div>)}
        {zichtbaar.map((d) => {
          const inMaand = maandVan(d) === maand
          const r = perDag.get(d) ?? []
          const werkdag = weekdagNr(d) <= 5
          const mk = inMaand ? label(d) : []
          return (
            <button key={d} type="button" disabled={!inMaand} onClick={() => onDag(d)}
              title={inMaand ? `${dagKort(d)}${r.length ? ` · ${r.map((n) => REEKSEN[n - 1].label).join(' + ')}` : ''}${mk.length ? ` · ${mk.join(', ')}` : ''}` : undefined}
              className={`relative h-16 sm:h-20 rounded-xl overflow-hidden border-2 text-left transition-transform ${inMaand ? 'hover:scale-[1.03] active:scale-100' : 'opacity-30'} ${d === vandaag ? 'border-cp-vandaag' : 'border-transparent'} ${!werkdag || !r.length ? 'bg-cp-achtergrond' : ''} ${focusRing}`}>
              {r.length > 0 && <div className="absolute inset-0 flex flex-col">{r.map((n) => <div key={n} className={`flex-1 ${REEKSEN[n - 1].kleur}`} />)}</div>}
              <span className={`absolute left-2 top-1.5 text-cp-basis font-bold ${r.length ? 'text-white drop-shadow' : ''}`}>{Number(d.slice(8))}</span>
              {mk.length > 0 && <span className="absolute left-1.5 bottom-1.5 right-1.5 truncate rounded-md bg-cp-ink text-cp-op-ink px-1.5 py-0.5 text-[10px] sm:text-[11px] font-semibold">{mk[0]}</span>}
            </button>
          )
        })}
      </div>
    </section>
  )
}

/** Knoppen per blok van een fase: verschuiven, begin en einde ±1 werkdag. */
function FaseRegel({ fase, plan, wd, kan, koppeling, pas }: { fase: FaseKey; plan: FasePlan; wd: string[]; kan: boolean; koppeling: Record<string, Reeks>; pas: (f: FaseKey, oud: [number, number], nieuw: [number, number], wat: string) => void }) {
  const segs = segmenten(plan[fase])
  const totaal = wd.length
  const knop = `inline-flex items-center justify-center h-9 w-9 rounded-lg border border-cp-rand hover:border-cp-ink disabled:opacity-40 ${focusRing}`
  return (
    <div className="space-y-2">
      <div className="text-cp-basis font-semibold flex items-center gap-2"><span className={`h-3 w-3 rounded-full ${kleurVan(fase, koppeling)}`} />{FASE_LABEL[fase]}
        {koppeling[fase] && <span className="text-cp-klein font-normal text-cp-zacht">· {REEKSEN[koppeling[fase] - 1].kort}</span>}</div>
      {segs.length === 0 && <div className="text-cp-klein text-cp-zacht">—</div>}
      {segs.map(([v, t]) => (
        <div key={`${v}-${t}`} className="flex items-center gap-1.5 flex-wrap">
          <span className="text-cp-basis min-w-[160px]">{periodeTekst(wd[v - 1], wd[t - 1])} <span className="text-cp-zacht text-cp-klein">· {t - v + 1} dag{t - v ? 'en' : ''}</span></span>
          {kan && (
            <>
              <span className="text-cp-klein text-cp-zacht ml-1">Begin</span>
              <button type="button" className={knop} disabled={v <= 1} onClick={() => pas(fase, [v, t], [v - 1, t], 'begint een dag vroeger')} aria-label={`${FASE_LABEL[fase]}: begin een dag vroeger`}><Minus className="h-4 w-4" /></button>
              <button type="button" className={knop} disabled={v >= t} onClick={() => pas(fase, [v, t], [v + 1, t], 'begint een dag later')} aria-label={`${FASE_LABEL[fase]}: begin een dag later`}><Plus className="h-4 w-4" /></button>
              <span className="text-cp-klein text-cp-zacht ml-1">Einde</span>
              <button type="button" className={knop} disabled={t <= v} onClick={() => pas(fase, [v, t], [v, t - 1], 'een dag korter')} aria-label={`${FASE_LABEL[fase]}: een dag korter`}><Minus className="h-4 w-4" /></button>
              <button type="button" className={knop} disabled={t >= totaal} onClick={() => pas(fase, [v, t], [v, t + 1], 'een dag langer')} aria-label={`${FASE_LABEL[fase]}: een dag langer`}><Plus className="h-4 w-4" /></button>
              <span className="text-cp-klein text-cp-zacht ml-1">Blok</span>
              <button type="button" className={knop} disabled={v <= 1} onClick={() => pas(fase, [v, t], [v - 1, t - 1], 'een dag vroeger')} aria-label={`${FASE_LABEL[fase]}: hele blok een dag vroeger`}><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" className={knop} disabled={t >= totaal} onClick={() => pas(fase, [v, t], [v + 1, t + 1], 'een dag later')} aria-label={`${FASE_LABEL[fase]}: hele blok een dag later`}><ChevronRight className="h-4 w-4" /></button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
