'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, Info, Route } from 'lucide-react'
import {
  FASE_KEYS, FASE_LABEL, REEKSEN, DAG_KORT, werkdagenVanMaand, weekdagNr, faseplanVanMaand, segmenten, pasFaseAan, wisselDag, planNaarDagen, reeksPeriodes,
  type FaseKey, type FasePlan, type Reeks,
} from '@/lib/contentplanning/model'
import { focusRing } from './bouwstenen'
import type { CpData, Doe } from './types'
import { MAANDEN, maandNaam } from './types'

/**
 * Reeksen — stap 2 op de eerste werkdag van de maand. De maand met de fases
 * (en dus de kleuren van de drie reeksen) zoals de Maandplanning ze heeft.
 * Aanpassen kan door te slepen:
 *   · einde of begin van een blok verslepen = langer/korter
 *   · midden van een blok verslepen = het hele blok verschuiven
 *   · klikken = één dag aan/uit
 * Met "Volgende fases schuiven mee" schuift alles wat ná het blok begint mee
 * (editen een dag langer → feedback en aanpassingen een dag later).
 * Bewaard als Maandplanning-aanpassingen; "Standaard herstellen" zet de maand terug.
 */

type Sleep = { fase: FaseKey; modus: 'begin' | 'einde' | 'blok'; oud: [number, number]; startDag: number; basis: FasePlan; dag: number; bewogen: boolean }
const kleurVan = (k: FaseKey, koppeling: Record<string, Reeks>) => (koppeling[k] ? REEKSEN[koppeling[k] - 1].kleur : 'bg-gray-400')
const dagKort = (d: string) => `${DAG_KORT[weekdagNr(d) - 1]} ${Number(d.slice(8))}`
const periodeTekst = (van: string, tot: string) => (van === tot ? dagKort(van) : `${dagKort(van)} – ${dagKort(tot)}`)

export function Reeksen({ data, maand, doe, vandaag }: { data: CpData; maand: string; doe: Doe; vandaag: string }) {
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
    if (!window.confirm(`De reeksen van ${maandNaam(maand)} terugzetten naar de standaardindeling? Ook aanpassingen die in de Maandplanning voor deze maand gemaakt zijn, vervallen.`)) return
    const vorig = plan
    const r = await doe('reeksen.herstel', { maand }, { stil: true })
    if (r) toast.success('Standaardindeling hersteld.', { action: { label: 'Ongedaan maken', onClick: () => { bewaar(vorig, basis, 'Teruggezet.') } } })
  }

  return (
    <div className="space-y-3">
      <div className="card-base p-3 space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="min-w-0">
            <h2 className="font-semibold flex items-center gap-2"><Route className="h-4 w-4" />Reeksen · <span className="capitalize">{maandNaam(maand)}</span></h2>
            <p className="text-xs text-gray-500">{totaal} werkdagen · {aangepast ? 'aangepast voor deze maand' : 'standaardindeling'}</p>
          </div>
          <div className="flex-1" />
          {kan && (
            <label className="inline-flex items-center gap-2 text-sm cursor-pointer select-none">
              <input type="checkbox" checked={meeschuiven} onChange={(e) => setMeeschuiven(e.target.checked)} className="h-4 w-4" />
              Volgende fases schuiven mee
            </label>
          )}
          {kan && aangepast && <button type="button" onClick={herstel} className={`btn-secondary text-sm ${focusRing}`}><RotateCcw className="h-4 w-4" />Standaard herstellen</button>}
        </div>
        {/* Wanneer loopt elke reeks? */}
        <div className="grid sm:grid-cols-3 gap-2">
          {REEKSEN.map((r) => {
            const p = periodes[r.nr]
            return (
              <div key={r.nr} className={`rounded-lg border border-gray-200 ${r.zacht} px-3 py-2`}>
                <div className="text-xs font-semibold flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${r.kleur}`} />{r.label}</div>
                <div className="text-sm mt-0.5">{p ? <>{periodeTekst(p.van, p.tot)} {MAANDEN[Number(p.tot.slice(5, 7)) - 1]} <span className="text-gray-500">· {p.dagen} werkdag{p.dagen === 1 ? '' : 'en'}</span></> : <span className="text-gray-500">deze maand niet gepland</span>}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Tijdlijn (vanaf tablet) */}
      <div className="hidden md:block card-base p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <div className="min-w-[760px] select-none">
            <div className="grid border-b border-gray-200 bg-gray-50" style={{ gridTemplateColumns: `190px repeat(${totaal}, minmax(26px, 1fr))` }}>
              <div className="px-3 py-1.5 text-[11px] font-medium text-gray-500 uppercase">Fase</div>
              {wd.map((d, i) => (
                <div key={d} className={`py-1 text-center leading-tight ${d === vandaag ? 'bg-[#fff848]' : ''} ${i > 0 && weekdagNr(d) === 1 ? 'border-l border-gray-300' : ''}`}>
                  <div className="text-[9px] uppercase text-gray-400">{DAG_KORT[weekdagNr(d) - 1]}</div>
                  <div className="text-[11px] font-semibold text-gray-700">{Number(d.slice(8))}</div>
                </div>
              ))}
            </div>
            {rijen.map((k) => {
              const segs = segmenten(plan[k])
              const kleur = kleurVan(k, koppeling)
              return (
                <div key={k} className={`grid border-b border-gray-100 last:border-b-0 ${gekozen === k ? 'bg-gray-50' : ''}`} style={{ gridTemplateColumns: `190px repeat(${totaal}, minmax(26px, 1fr))` }}>
                  <button type="button" onClick={() => setGekozen(gekozen === k ? null : k)} aria-pressed={gekozen === k}
                    className={`px-3 py-2 text-left text-sm flex items-center gap-2 ${focusRing}`}>
                    <span className={`h-2.5 w-2.5 rounded-full shrink-0 ${kleur}`} /><span className="truncate">{FASE_LABEL[k]}</span>
                  </button>
                  {wd.map((d, i) => {
                    const nr = i + 1
                    const aan = plan[k].includes(nr)
                    const seg = segs.find(([v, t]) => nr >= v && nr <= t)
                    const eerste = seg && seg[0] === nr, laatste = seg && seg[1] === nr
                    return (
                      <div key={d} data-dag={nr} onPointerDown={(e) => begin(e, k, nr)} style={kan ? { touchAction: 'none' } : undefined}
                        title={`${FASE_LABEL[k]} · ${dagKort(d)}${kan ? (aan ? (laatste ? ' · sleep om langer/korter te maken' : eerste ? ' · sleep om vroeger/later te beginnen' : ' · sleep om het blok te verschuiven, klik om deze dag weg te halen') : ' · klik om toe te voegen') : ''}`}
                        className={`relative py-2 ${i > 0 && weekdagNr(d) === 1 ? 'border-l border-gray-200' : ''} ${kan ? (aan ? (laatste || eerste ? 'cursor-ew-resize' : 'cursor-grab') : 'cursor-pointer hover:bg-gray-100') : ''}`}>
                        {aan && (
                          <div className={`h-5 ${kleur} ${eerste ? 'rounded-l-md ml-0.5' : ''} ${laatste ? 'rounded-r-md mr-0.5' : ''} relative`}>
                            {kan && laatste && <span className="absolute right-0.5 top-1 bottom-1 w-1 rounded bg-white/70" aria-hidden />}
                            {kan && eerste && !laatste && <span className="absolute left-0.5 top-1 bottom-1 w-1 rounded bg-white/70" aria-hidden />}
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
        {gekozen && <div className="border-t border-gray-200 p-3"><FaseRegel fase={gekozen} plan={plan} wd={wd} kan={kan} koppeling={koppeling} pas={pas} /></div>}
      </div>

      {/* Telefoon: per fase een kaart met knoppen */}
      <div className="md:hidden space-y-2">
        {rijen.map((k) => <div key={k} className="card-base p-3"><FaseRegel fase={k} plan={plan} wd={wd} kan={kan} koppeling={koppeling} pas={pas} /></div>)}
      </div>

      <p className="text-[11px] text-gray-500 flex items-start gap-1.5"><Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
        <span>Sleep het <b>einde</b> van een blok om het langer of korter te maken, het <b>begin</b> om vroeger of later te starten, of het <b>midden</b> om het hele blok te verschuiven. Klik op een dag om die aan of uit te zetten. Klik op een fasenaam voor knoppen (ook met het toetsenbord). Met “Volgende fases schuiven mee” verschuift alles wat ná het aangepaste blok begint even veel. De kleuren volgen de reeksen; de klanten per reeks staan in Klantenbatches.</span>
      </p>
    </div>
  )
}

/** Knoppen per blok van een fase: verschuiven, begin en einde ±1 werkdag. */
function FaseRegel({ fase, plan, wd, kan, koppeling, pas }: { fase: FaseKey; plan: FasePlan; wd: string[]; kan: boolean; koppeling: Record<string, Reeks>; pas: (f: FaseKey, oud: [number, number], nieuw: [number, number], wat: string) => void }) {
  const segs = segmenten(plan[fase])
  const totaal = wd.length
  const knop = `inline-flex items-center gap-0.5 rounded-lg border border-gray-200 px-2 py-1 text-xs hover:border-gray-500 disabled:opacity-40 ${focusRing}`
  return (
    <div className="space-y-2">
      <div className="text-sm font-semibold flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${kleurVan(fase, koppeling)}`} />{FASE_LABEL[fase]}
        {koppeling[fase] && <span className="text-[11px] font-normal text-gray-500">· {REEKSEN[koppeling[fase] - 1].kort}</span>}</div>
      {segs.length === 0 && (
        <div className="text-xs text-gray-500">Deze maand niet gepland.{kan && ' Klik in de tijdlijn (computer of tablet) op een dag om deze fase toe te voegen.'}</div>
      )}
      {segs.map(([v, t]) => (
        <div key={`${v}-${t}`} className="flex items-center gap-1.5 flex-wrap">
          <span className="text-sm min-w-[150px]">{periodeTekst(wd[v - 1], wd[t - 1])} <span className="text-gray-500 text-xs">· {t - v + 1} dag{t - v ? 'en' : ''}</span></span>
          {kan && (
            <>
              <span className="text-[11px] text-gray-500 ml-1">Begin</span>
              <button type="button" className={knop} disabled={v <= 1} onClick={() => pas(fase, [v, t], [v - 1, t], 'begint een dag vroeger')} aria-label={`${FASE_LABEL[fase]}: begin een dag vroeger`}><Minus className="h-3 w-3" /></button>
              <button type="button" className={knop} disabled={v >= t} onClick={() => pas(fase, [v, t], [v + 1, t], 'begint een dag later')} aria-label={`${FASE_LABEL[fase]}: begin een dag later`}><Plus className="h-3 w-3" /></button>
              <span className="text-[11px] text-gray-500 ml-1">Einde</span>
              <button type="button" className={knop} disabled={t <= v} onClick={() => pas(fase, [v, t], [v, t - 1], 'een dag korter')} aria-label={`${FASE_LABEL[fase]}: een dag korter`}><Minus className="h-3 w-3" /></button>
              <button type="button" className={knop} disabled={t >= totaal} onClick={() => pas(fase, [v, t], [v, t + 1], 'een dag langer')} aria-label={`${FASE_LABEL[fase]}: een dag langer`}><Plus className="h-3 w-3" /></button>
              <span className="text-[11px] text-gray-500 ml-1">Blok</span>
              <button type="button" className={knop} disabled={v <= 1} onClick={() => pas(fase, [v, t], [v - 1, t - 1], 'een dag vroeger')} aria-label={`${FASE_LABEL[fase]}: hele blok een dag vroeger`}><ChevronLeft className="h-3 w-3" /></button>
              <button type="button" className={knop} disabled={t >= totaal} onClick={() => pas(fase, [v, t], [v + 1, t + 1], 'een dag later')} aria-label={`${FASE_LABEL[fase]}: hele blok een dag later`}><ChevronRight className="h-3 w-3" /></button>
            </>
          )}
        </div>
      ))}
    </div>
  )
}
