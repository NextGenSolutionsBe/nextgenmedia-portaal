'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Archive, Check, ChevronLeft, ChevronRight, Paperclip, Pencil, PiggyBank, Plus, Repeat, RotateCcw, X } from 'lucide-react'
import { RegelsKaart, RegelsKnop, RegelsVenster, type RegelsBegin } from '@/components/admin/regels-akkoord'
import type { RegelsData } from '@/lib/regels-akkoord'
import {
  FREQ, STANDAARD_REGELS, akkoordStand, budgetVan, openAkkoorden, openAkkoordenTekst, perMaand, periodeOpties, periodeVan, standPerVennoot,
  terugkerendStand, terugkerendeUitgaven, uitgavenIn, verschuif,
  type BudgetExtra, type Periode, type PeriodeSoort, type Terugkerend, type Uitgave, type Vennoot,
} from '@/lib/vennoot-uitgaven'
import type { VennotenData } from '@/lib/vennoot-uitgaven-server'
import { AkkoordChips, SchrapVenster, dag, eur, eurKort, maand, post } from './gedeeld'
import { ExtraBudgetKaart, ExtraVenster, extraTeTonen } from './extra-budget'
import { TerugkerendKaart } from './terugkerend'
import { UitgaveVenster, type Soort } from './uitgave-venster'

type Open =
  | { soort: 'uitgave'; u: Uitgave | null; begin?: Soort }
  | { soort: 'terugkerend'; t: Terugkerend }
  | { soort: 'extra'; e: BudgetExtra | null }
  | { soort: 'archiveer'; u: Uitgave }
  | { soort: 'schrapExtra'; e: BudgetExtra }
  | { soort: 'schrapTerugkerend'; t: Terugkerend }

/**
 * Uitgaven vennoten. Bovenaan per vennoot het tegoed (opgespaard budget plus
 * goedgekeurd extra budget, min wat al besteed is) en wat er in de gekozen
 * periode uitging; klik op een vennoot voor enkel zijn of haar uitgaven.
 * "+ Uitgave" is eenmalig (met bonnetje) of terugkerend (lease, huur,
 * abonnement: elke betaling telt vanzelf mee). "Extra budget" = een vennoot
 * (of alle drie) mag in een maand meer uitgeven, met een onderbouwing; het
 * telt pas als alle drie akkoord gaven.
 */
export function VennotenClient({ data, vandaag, beginVennoot, regelsOpen, akkoordFilter = false }: { data: VennotenData; vandaag: string; beginVennoot: Vennoot | null; regelsOpen: boolean; akkoordFilter?: boolean }) {
  const router = useRouter()
  const huidigeMaand = vandaag.slice(0, 7)
  const [soort, setSoort] = useState<PeriodeSoort | 'alles'>('maand')
  const [periode, setPeriode] = useState<Periode>(() => periodeVan('maand', huidigeMaand))
  const [vennoot, setVennoot] = useState<Vennoot | null>(beginVennoot)
  const [archief, setArchief] = useState(false)
  const [open, setOpen] = useState<Open | null>(null)
  const [regels, setRegels] = useState<RegelsBegin | null>(regelsOpen ? 'bekijk' : null)
  const [enkelWacht, setEnkelWacht] = useState(akkoordFilter)
  const [akkoordBezig, setAkkoordBezig] = useState<string | null>(null)
  const klaar = (melding: string) => { setOpen(null); toast.success(melding); router.refresh() }

  // De betalingen van terugkerende uitgaven tot vandaag tellen als gewone uitgaven.
  const terugMap = useMemo(() => new Map(data.terugkerend.map((t) => [t.id, t])), [data.terugkerend])
  const alleUitgaven = useMemo(() => [...data.uitgaven, ...terugkerendeUitgaven(data.terugkerend, vandaag)], [data.uitgaven, data.terugkerend, vandaag])
  const mijnOpen = useMemo(() => (data.ik ? openAkkoorden(data, data.ik) : null), [data])
  const mijnWacht = mijnOpen?.uitgaven ?? []

  const geefAkkoord = async (u: Uitgave) => {
    setAkkoordBezig(u.id)
    try { await post({ actie: 'akkoord', id: u.id }); klaar('Akkoord gegeven.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Akkoord mislukt') } finally { setAkkoordBezig(null) }
  }

  const budget = budgetVan(data.regels, data.uitgaven, huidigeMaand)
  const alles = soort === 'alles'
  const stand = useMemo(() => standPerVennoot(alleUitgaven, budget, periode, huidigeMaand, data.extras, data.extraAkkoorden), [alleUitgaven, budget, periode, huidigeMaand, data.extras, data.extraAkkoorden])
  const lijst = useMemo(() => {
    const l = uitgavenIn(alleUitgaven, alles ? null : periode, vennoot, archief)
    return enkelWacht && !archief ? l.filter((u) => mijnWacht.some((w) => w.id === u.id)) : l
  }, [alleUitgaven, alles, periode, vennoot, archief, enkelWacht, mijnWacht])
  const aantalArchief = useMemo(() => uitgavenIn(data.uitgaven, alles ? null : periode, vennoot, true).length, [data.uitgaven, alles, periode, vennoot])
  const totaal = lijst.reduce((s, u) => s + u.bedrag, 0)
  const regelsData: RegelsData = { versie: data.regels, handtekeningen: data.handtekeningen, namen: data.namen, ik: data.ik }
  const label = alles ? 'alle periodes' : periode.label

  // De periodes om uit te kiezen: van de eerste uitgave (of de start van het budget) tot nu.
  const eersteMaand = useMemo(() => [budget.start_maand, ...alleUitgaven.map((u) => u.datum.slice(0, 7))].sort()[0] ?? null, [budget.start_maand, alleUitgaven])
  const opties = useMemo(() => {
    if (alles) return []
    const l = periodeOpties(soort as PeriodeSoort, eersteMaand, huidigeMaand)
    return l.some((p) => p.ref === periode.ref) ? l : [...l, periode].sort((a, b) => b.ref.localeCompare(a.ref))
  }, [alles, soort, eersteMaand, huidigeMaand, periode])
  const groepen = useMemo(() => perMaand(lijst), [lijst])
  const metKoppen = groepen.length > 1 || soort !== 'maand'
  const kiesSoort = (s: PeriodeSoort | 'alles') => { setSoort(s); if (s !== 'alles') setPeriode(periodeVan(s, periode.ref > huidigeMaand ? huidigeMaand : periode.ref)) }

  // De kaarten voor extra budget en terugkerende uitgaven verschijnen zodra er iets in staat.
  const toonExtra = extraTeTonen(data, vennoot, alles ? null : periode)
  const toonTerug = data.terugkerend.some((t) => !vennoot || t.vennoot === vennoot)

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold">Uitgaven vennoten</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">{eur(budget.maandbudget)} per vennoot per maand; wat je niet gebruikt, spaar je.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <RegelsKnop set="vennoten" data={regelsData} onOpen={setRegels} />
          <button type="button" onClick={() => setOpen({ soort: 'extra', e: null })} className="btn-secondary text-sm"><PiggyBank className="h-4 w-4" />Extra budget</button>
          <button type="button" onClick={() => setOpen({ soort: 'uitgave', u: null })} className="btn-primary text-sm"><Plus className="h-4 w-4" />Uitgave</button>
        </div>
      </div>

      {/* Wat wacht op jouw akkoord */}
      {mijnOpen && mijnOpen.totaal > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950 flex items-center gap-3 flex-wrap">
          <span className="flex-1 min-w-[200px]"><b className="font-semibold">{openAkkoordenTekst(mijnOpen)} {mijnOpen.totaal === 1 ? 'wacht' : 'wachten'} op jouw akkoord.</b> Kijk na en druk op Akkoord, zo is er achteraf geen discussie.</span>
          {mijnWacht.length > 0 && <button type="button" onClick={() => { setEnkelWacht((x) => !x); setArchief(false); if (!enkelWacht) setSoort('alles') }} className="btn-secondary text-sm">{enkelWacht ? 'Alle uitgaven tonen' : 'Toon enkel die uitgaven'}</button>}
        </div>
      )}

      {/* Periode */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden bg-white" role="group" aria-label="Periode">
          {(['maand', 'kwartaal', 'jaar', 'alles'] as const).map((s) => (
            <button key={s} type="button" onClick={() => kiesSoort(s)} aria-pressed={soort === s} className={`text-xs px-3 py-1.5 border-l first:border-l-0 border-gray-200 capitalize ${soort === s ? 'bg-black text-white' : 'hover:bg-gray-50'}`}>{s}</button>
          ))}
        </div>
        {!alles && (
          <div className="inline-flex items-center gap-1">
            <button type="button" onClick={() => setPeriode((p) => verschuif(p, -1))} className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-gray-100" aria-label="Vorige periode"><ChevronLeft className="h-4 w-4" /></button>
            <select aria-label="Kies de periode" value={periode.ref} onChange={(e) => setPeriode(periodeVan(soort as PeriodeSoort, e.target.value))}
              className="text-sm font-semibold capitalize bg-white border border-gray-200 rounded-lg pl-3 pr-8 py-1.5 min-w-[9.5rem]">
              {opties.map((p) => <option key={p.ref} value={p.ref}>{p.label}</option>)}
            </select>
            <button type="button" onClick={() => setPeriode((p) => verschuif(p, 1))} disabled={periode.maanden.includes(huidigeMaand) || periode.ref > huidigeMaand} className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-gray-100 disabled:opacity-30" aria-label="Volgende periode"><ChevronRight className="h-4 w-4" /></button>
            {!periode.maanden.includes(huidigeMaand) && <button type="button" onClick={() => setPeriode(periodeVan(soort as PeriodeSoort, huidigeMaand))} className="text-xs text-gray-500 underline ml-1">Nu</button>}
          </div>
        )}
      </div>

      {/* Per vennoot */}
      <div className="grid gap-2 sm:gap-3 grid-cols-3">
        {stand.map((s) => {
          const besteed = alles ? s.besteedTotaal : s.besteedPeriode
          const max = alles ? s.budgetTotaal : s.budgetPeriode
          const extra = alles ? s.extraTotaal : s.extraPeriode
          const pct = max > 0 ? Math.min(100, Math.round((besteed / max) * 100)) : besteed > 0 ? 100 : 0
          const aan = vennoot === s.vennoot
          return (
            <button key={s.vennoot} type="button" onClick={() => setVennoot(aan ? null : s.vennoot)} aria-pressed={aan}
              className={`card-base !p-3 sm:!p-5 text-left space-y-1.5 sm:space-y-2 transition min-w-0 ${aan ? 'ring-2 ring-gray-900' : 'hover:border-gray-300'}`}>
              <div className="flex items-center justify-between gap-1">
                <span className="font-semibold text-gray-900 truncate">{data.namen[s.vennoot]}</span>
                {aan ? <Check className="h-4 w-4 shrink-0" /> : <span className="hidden sm:inline text-[11px] text-gray-500">klik om te kiezen</span>}
              </div>
              <div>
                <div className="text-[10px] sm:text-[11px] text-gray-500">Tegoed</div>
                <div className={`text-base sm:text-2xl font-semibold tabular-nums ${s.tegoed < 0 ? 'text-red-600' : 'text-green-700'}`}>{eur(s.tegoed)}</div>
              </div>
              <div>
                <div className="flex flex-col sm:flex-row sm:justify-between text-[10px] sm:text-xs text-gray-600"><span className="truncate">Besteed{alles ? '' : ` in ${label}`}</span><span className="tabular-nums">{eur(besteed)}<span className="hidden sm:inline"> van {eur(max)}</span></span></div>
                <div className="h-1.5 rounded-full bg-gray-100 mt-1 overflow-hidden"><div className={`h-1.5 rounded-full ${besteed > max ? 'bg-red-500' : 'bg-gray-900'}`} style={{ width: `${pct}%` }} /></div>
              </div>
              {extra > 0 && <div className="text-[10px] sm:text-[11px] text-green-700 font-medium truncate">+{eurKort(extra)} extra<span className="hidden sm:inline"> budget</span></div>}
              <div className="hidden sm:block text-[11px] text-gray-500">In totaal besteed: {eur(s.besteedTotaal)}</div>
            </button>
          )
        })}
      </div>

      {/* Extra budget en terugkerende uitgaven */}
      {(toonExtra || toonTerug) && (
        <div className={`grid gap-3 sm:gap-4 items-start ${toonExtra && toonTerug ? 'lg:grid-cols-2' : ''}`}>
          {toonExtra && <ExtraBudgetKaart data={data} huidigeMaand={huidigeMaand} periode={alles ? null : periode} label={label} vennoot={vennoot}
            onNieuw={() => setOpen({ soort: 'extra', e: null })} onBewerk={(e) => setOpen({ soort: 'extra', e })} onKlaar={klaar} />}
          {toonTerug && <TerugkerendKaart data={data} vandaag={vandaag} vennoot={vennoot}
            onNieuw={() => setOpen({ soort: 'uitgave', u: null, begin: 'terugkerend' })} onBewerk={(t) => setOpen({ soort: 'terugkerend', t })} onKlaar={klaar} />}
        </div>
      )}

      {/* Lijst */}
      <section className="card-base !p-0 overflow-hidden">
        <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 w-full sm:w-auto sm:flex-1 min-w-0">
            {vennoot ? `${data.namen[vennoot]}: ` : 'Alle vennoten: '}{archief ? 'gearchiveerd' : 'uitgaven'} in {label}
          </h2>
          {vennoot && <button type="button" onClick={() => setVennoot(null)} className="text-xs px-2.5 py-1 rounded-full border border-gray-200 hover:bg-gray-50 inline-flex items-center gap-1"><X className="h-3 w-3" />Alle vennoten</button>}
          <button type="button" onClick={() => setArchief((a) => !a)} aria-pressed={archief} className={`text-xs px-2.5 py-1 rounded-full border inline-flex items-center gap-1 ${archief ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50'}`}><Archive className="h-3 w-3" />Archief ({aantalArchief})</button>
        </div>
        {lijst.length === 0 ? (
          <div className="px-4 py-8 text-sm text-gray-500 text-center space-y-2">
            <p>{archief ? 'Niets gearchiveerd' : `Geen uitgaven${vennoot ? ` van ${data.namen[vennoot]}` : ''}`} in {label}.</p>
            {!alles && soort !== 'jaar' && <button type="button" onClick={() => kiesSoort('jaar')} className="btn-secondary text-xs">Toon het hele jaar</button>}
          </div>
        ) : (
          <div>
            {groepen.map((g) => (
              <div key={g.maand}>
                {metKoppen && (
                  <div className="px-4 py-2 bg-gray-50/80 border-b border-gray-100 flex items-baseline justify-between text-xs">
                    <span className="font-semibold text-gray-700 capitalize">{g.label}</span>
                    <span className="text-gray-500 tabular-nums">{g.uitgaven.length} · <b className="font-semibold text-gray-800">{eur(g.totaal)}</b></span>
                  </div>
                )}
                <ul className="divide-y divide-gray-100 border-b border-gray-100 last:border-b-0">
                  {g.uitgaven.map((u) => {
                    const t = u.terugkerend_id ? terugMap.get(u.terugkerend_id) ?? null : null
                    const bewerk = () => (t ? setOpen({ soort: 'terugkerend', t }) : u.gearchiveerd_op ? null : setOpen({ soort: 'uitgave', u }))
                    return (
                      <li key={u.id} className="px-4 py-3 flex items-start gap-2">
                        <div className="min-w-0 flex-1">
                          <button type="button" onClick={bewerk} disabled={!t && !!u.gearchiveerd_op} className="w-full text-left flex items-start gap-3 rounded-lg -m-1 p-1 hover:bg-gray-50 disabled:hover:bg-transparent">
                            <span className="min-w-0 flex-1">
                              <span className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                                <span className="tabular-nums">{dag(u.datum)}</span>
                                {!vennoot && <span className="inline-flex text-[11px] font-semibold text-gray-800 rounded-full bg-gray-100 px-2 py-0.5">{data.namen[u.vennoot]}</span>}
                                {t ? (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-800 rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5"><Repeat className="h-3 w-3" />{FREQ[t.frequentie].elke}</span>
                                ) : u.bewijs_pad ? <span className="inline-flex items-center gap-1 text-gray-600"><Paperclip className="h-3.5 w-3.5" />Bon</span> : <span className="text-amber-700">geen bon</span>}
                              </span>
                              <span className="block text-sm font-medium text-gray-900 mt-0.5">{u.omschrijving}</span>
                              {u.doel && <span className="block text-xs text-gray-500 mt-0.5">{u.doel}</span>}
                            </span>
                            <span className="text-sm font-semibold tabular-nums shrink-0">{eur(u.bedrag)}</span>
                          </button>
                          {u.gearchiveerd_op && <div className="text-xs text-amber-800 mt-1">Gearchiveerd{u.gearchiveerd_door ? ` door ${u.gearchiveerd_door}` : ''}: {u.archief_reden}</div>}
                          {!u.gearchiveerd_op && !t && (
                            <div className="mt-1.5"><AkkoordChips stand={akkoordStand(u, data.akkoorden)} namen={data.namen} ik={data.ik} bezig={akkoordBezig === u.id} onAkkoord={() => geefAkkoord(u)} /></div>
                          )}
                          {t && !terugkerendStand(t, data.terugkerendAkkoorden).allen && <div className="text-[11px] text-amber-700 mt-1">De afspraak wacht nog op een akkoord</div>}
                        </div>
                        <div className="flex flex-col items-center gap-0.5 shrink-0 -mr-1">
                          {t ? (
                            <button type="button" onClick={bewerk} className="h-9 w-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Terugkerende uitgave aanpassen" aria-label="Terugkerende uitgave aanpassen"><Pencil className="h-4 w-4" /></button>
                          ) : u.gearchiveerd_op ? (
                            <button type="button" onClick={async () => { try { await post({ actie: 'terugzetten', id: u.id }); klaar('Teruggezet.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } }} className="h-9 w-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Terugzetten" aria-label="Terugzetten"><RotateCcw className="h-4 w-4" /></button>
                          ) : (
                            <>
                              <button type="button" onClick={bewerk} className="h-9 w-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Aanpassen" aria-label="Aanpassen"><Pencil className="h-4 w-4" /></button>
                              <button type="button" onClick={() => setOpen({ soort: 'archiveer', u })} className="h-9 w-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Archiveren" aria-label="Archiveren"><Archive className="h-4 w-4" /></button>
                            </>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
        {lijst.length > 0 && <div className="px-4 py-3 border-t border-gray-100 flex justify-between text-sm"><span className="text-gray-600">{lijst.length} {lijst.length === 1 ? 'uitgave' : 'uitgaven'}</span><span className="font-semibold tabular-nums">{eur(totaal)}</span></div>}
      </section>

      <RegelsKaart set="vennoten" data={regelsData} onOpen={setRegels} />

      {open?.soort === 'uitgave' && (
        <UitgaveVenster u={open.u} begin={open.begin} beginVennoot={vennoot ?? data.ik} data={data} vandaag={vandaag}
          onArchiveer={open.u ? () => setOpen({ soort: 'archiveer', u: open.u! }) : undefined}
          onSluit={() => setOpen(null)} onKlaar={klaar} />
      )}
      {open?.soort === 'terugkerend' && (
        <UitgaveVenster t={open.t} beginVennoot={vennoot ?? data.ik} data={data} vandaag={vandaag}
          onSchrap={open.t.gearchiveerd_op ? undefined : () => setOpen({ soort: 'schrapTerugkerend', t: open.t })}
          onSluit={() => setOpen(null)} onKlaar={klaar} />
      )}
      {open?.soort === 'extra' && (
        <ExtraVenster e={open.e} data={data} huidigeMaand={huidigeMaand} beginVennoot={vennoot}
          onSchrap={open.e && !open.e.gearchiveerd_op ? () => setOpen({ soort: 'schrapExtra', e: open.e! }) : undefined}
          onSluit={() => setOpen(null)} onKlaar={klaar} />
      )}
      {open?.soort === 'archiveer' && (
        <SchrapVenster titel="Uitgave archiveren" actie="archiveer" id={open.u.id} knop="Archiveren"
          regel={<><b className="font-semibold">{data.namen[open.u.vennoot]}</b> · {open.u.omschrijving} · {eur(open.u.bedrag)}</>}
          uitleg="Een gearchiveerde uitgave telt niet meer mee voor het tegoed. Ze blijft zichtbaar in het archief, met de reden erbij."
          onSluit={() => setOpen(null)} onKlaar={() => klaar('Gearchiveerd. Telt niet meer mee.')} />
      )}
      {open?.soort === 'schrapExtra' && (
        <SchrapVenster titel="Extra budget schrappen" actie="extra.archiveer" id={open.e.id} knop="Schrappen" voorstel="Niet doorgegaan."
          regel={<><b className="font-semibold capitalize">{maand(open.e.maand)}</b> · +{eurKort(open.e.bedrag)}{open.e.vennoten.length > 1 ? ' per vennoot' : ''}</>}
          uitleg="Geschrapt extra budget telt niet mee. Het blijft zichtbaar onder Geschrapt, met de reden erbij, en kan teruggezet worden."
          onSluit={() => setOpen(null)} onKlaar={() => klaar('Geschrapt. Telt niet meer mee.')} />
      )}
      {open?.soort === 'schrapTerugkerend' && (
        <SchrapVenster titel="Terugkerende uitgave schrappen" actie="terugkerend.archiveer" id={open.t.id} knop="Schrappen" voorstel="Per vergissing ingegeven."
          regel={<><b className="font-semibold">{data.namen[open.t.vennoot]}</b> · {open.t.omschrijving} · {eur(open.t.bedrag)} {FREQ[open.t.frequentie].per}</>}
          uitleg="Schrappen = geen enkele betaling telt nog mee, ook de vorige niet. Loopt het gewoon af? Gebruik dan Stoppen."
          onSluit={() => setOpen(null)} onKlaar={() => klaar('Geschrapt. De betalingen tellen niet meer mee.')} />
      )}
      {regels && <RegelsVenster set="vennoten" data={regelsData} huidigeMaand={huidigeMaand} standaardRegels={STANDAARD_REGELS} begin={regels} onSluit={() => setRegels(null)} onKlaar={(m) => klaar(m)} />}
    </div>
  )
}
