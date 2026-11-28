'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Check, Loader2, PiggyBank, Plus, RotateCcw, Trash2 } from 'lucide-react'
import { leesGetal } from '@/lib/getal'
import { VENNOTEN, extraStand, namenLijst, type BudgetExtra, type Periode, type Vennoot } from '@/lib/vennoot-uitgaven'
import type { VennotenData } from '@/lib/vennoot-uitgaven-server'
import { AkkoordChips, KleinKnopje, Venster, bedragTekst, dag, eurKort, inp, lbl, maand, post } from './gedeeld'
import { PersoonFoto } from '@/components/admin/persoon-foto'

type Status = { tekst: string; klasse: string }

/** Is er iets te tonen: wat op een akkoord wacht, of extra budget in de gekozen periode (bij "alles": alles, ook geschrapt). */
export function extraTeTonen(data: VennotenData, vennoot: Vennoot | null, periode: Periode | null): boolean {
  return data.extras.some((e) => (!vennoot || e.vennoten.includes(vennoot)) && (!periode || (!e.gearchiveerd_op && (!extraStand(e, data.extraAkkoorden).allen || periode.maanden.includes(e.maand)))))
}

function statusVan(e: BudgetExtra, data: VennotenData, huidigeMaand: string): Status {
  const s = extraStand(e, data.extraAkkoorden)
  if (!s.allen) return { tekst: 'Wacht op akkoord', klasse: 'bg-amber-50 text-amber-800 border-amber-200' }
  if (e.maand > huidigeMaand) return { tekst: `Goedgekeurd, telt vanaf ${maand(e.maand)}`, klasse: 'bg-gray-50 text-gray-700 border-gray-200' }
  return { tekst: 'Telt mee', klasse: 'bg-green-50 text-green-800 border-green-200' }
}

const voorWie = (e: Pick<BudgetExtra, 'vennoten'>, namen: Record<Vennoot, string>) =>
  e.vennoten.length === VENNOTEN.length ? 'Alle drie' : namenLijst(VENNOTEN.filter((k) => e.vennoten.includes(k)).map((k) => namen[k]))

/**
 * Extra budget: wat een vennoot (of alle drie) in een maand meer mag uitgeven,
 * met de reden. Wat nog op een akkoord wacht staat altijd bovenaan; goedgekeurd
 * extra budget toont de kaart in de gekozen periode.
 */
export function ExtraBudgetKaart({ data, huidigeMaand, periode, label, vennoot, onNieuw, onBewerk, onKlaar }: {
  data: VennotenData; huidigeMaand: string; periode: Periode | null; label: string; vennoot: Vennoot | null
  onNieuw: () => void; onBewerk: (e: BudgetExtra) => void; onKlaar: (m: string) => void
}) {
  const [alle, setAlle] = useState(false)
  const [geschraptOpen, setGeschraptOpen] = useState(false)
  const [bezig, setBezig] = useState<string | null>(null)
  const eigen = useMemo(() => data.extras.filter((e) => !vennoot || e.vennoten.includes(vennoot)), [data.extras, vennoot])
  const actief = eigen.filter((e) => !e.gearchiveerd_op)
  const geschrapt = eigen.filter((e) => e.gearchiveerd_op)
  const wacht = (e: BudgetExtra) => !extraStand(e, data.extraAkkoorden).allen
  const zichtbaar = (alle ? actief : actief.filter((e) => wacht(e) || !periode || periode.maanden.includes(e.maand)))
    .sort((a, b) => Number(wacht(b)) - Number(wacht(a)) || b.maand.localeCompare(a.maand))
  const verborgen = actief.length - zichtbaar.length

  const akkoord = async (e: BudgetExtra) => {
    setBezig(e.id)
    try { await post({ actie: 'extra.akkoord', id: e.id }); onKlaar('Akkoord gegeven.') } catch (x) { toast.error(x instanceof Error ? x.message : 'Akkoord mislukt') } finally { setBezig(null) }
  }
  const terug = async (e: BudgetExtra) => {
    try { await post({ actie: 'extra.terugzetten', id: e.id }); onKlaar('Teruggezet. Het telt weer mee zodra alle drie akkoord gaven.') } catch (x) { toast.error(x instanceof Error ? x.message : 'Mislukt') }
  }

  return (
    <section className="card-base !p-0 overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <PiggyBank className="h-4 w-4 text-gray-500 shrink-0" />
        <h2 className="font-semibold text-gray-900 flex-1 min-w-0">Extra budget</h2>
        <button type="button" onClick={onNieuw} className="text-xs px-2.5 py-1 rounded-full border border-gray-200 hover:bg-gray-50 inline-flex items-center gap-1"><Plus className="h-3 w-3" />Toevoegen</button>
      </div>
      {zichtbaar.length === 0 ? (
        <p className="px-4 py-4 text-sm text-gray-500">Geen extra budget in {label}.</p>
      ) : (
        <ul className="divide-y divide-gray-100">
          {zichtbaar.map((e) => {
            const st = statusVan(e, data, huidigeMaand)
            return (
              <li key={e.id} className="px-4 py-3 space-y-2">
                <button type="button" onClick={() => onBewerk(e)} className="w-full text-left flex items-start gap-3 rounded-lg -m-1 p-1 hover:bg-gray-50">
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 flex-wrap text-xs">
                      <span className="font-semibold text-gray-900 capitalize text-sm">{maand(e.maand)}</span>
                      <span className="inline-flex text-[11px] font-semibold text-gray-800 rounded-full bg-gray-100 px-2 py-0.5">{voorWie(e, data.namen)}</span>
                    </span>
                    <span className="block text-sm text-gray-600 mt-1 line-clamp-2">{e.reden}</span>
                  </span>
                  <span className="text-right shrink-0">
                    <span className="block text-sm font-semibold tabular-nums text-green-700">+{eurKort(e.bedrag)}</span>
                    {e.vennoten.length > 1 && <span className="block text-[11px] text-gray-500">elk</span>}
                  </span>
                </button>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${st.klasse}`}>{st.tekst}</span>
                  <AkkoordChips stand={extraStand(e, data.extraAkkoorden)} namen={data.namen} ik={data.ik} bezig={bezig === e.id} onAkkoord={() => akkoord(e)} klaarTekst="" />
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {(verborgen > 0 || alle || geschrapt.length > 0) && (
        <div className="px-4 py-2.5 border-t border-gray-100 flex gap-2 flex-wrap">
          {(verborgen > 0 || alle) && <KleinKnopje aan={alle} onClick={() => setAlle((x) => !x)}>{alle ? 'Enkel deze periode' : `Toon alle (${actief.length})`}</KleinKnopje>}
          {geschrapt.length > 0 && <KleinKnopje aan={geschraptOpen} onClick={() => setGeschraptOpen((x) => !x)}><Trash2 className="h-3 w-3" />Geschrapt ({geschrapt.length})</KleinKnopje>}
        </div>
      )}
      {geschraptOpen && geschrapt.length > 0 && (
        <ul className="divide-y divide-gray-100 border-t border-gray-100 bg-gray-50/60">
          {geschrapt.map((e) => (
            <li key={e.id} className="px-4 py-3 flex items-start gap-2">
              <div className="min-w-0 flex-1 text-sm">
                <div className="text-gray-700"><span className="capitalize">{maand(e.maand)}</span> · {voorWie(e, data.namen)} · +{eurKort(e.bedrag)}{e.vennoten.length > 1 ? ' elk' : ''}</div>
                <div className="text-xs text-amber-800 mt-0.5">Geschrapt{e.gearchiveerd_door ? ` door ${e.gearchiveerd_door}` : ''}: {e.archief_reden}</div>
              </div>
              <button type="button" onClick={() => terug(e)} className="h-9 w-9 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100 shrink-0" title="Terugzetten" aria-label="Terugzetten"><RotateCcw className="h-4 w-4" /></button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Maanden om uit te kiezen: een jaar terug tot een jaar vooruit (en de maand die er al staat). */
function maandOpties(huidigeMaand: string, extra?: string): string[] {
  const [j, m] = huidigeMaand.split('-').map(Number)
  const uit: string[] = []
  for (let i = 12; i >= -12; i--) {
    const t = j * 12 + (m - 1) + i
    uit.push(`${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`)
  }
  if (extra && !uit.includes(extra)) uit.push(extra)
  return uit.sort((a, b) => b.localeCompare(a))
}

export function ExtraVenster({ e, data, huidigeMaand, beginVennoot, onSchrap, onSluit, onKlaar }: {
  e: BudgetExtra | null; data: VennotenData; huidigeMaand: string; beginVennoot: Vennoot | null
  onSchrap?: () => void; onSluit: () => void; onKlaar: (m: string) => void
}) {
  const [wie, setWie] = useState<Vennoot[]>(e?.vennoten ?? (beginVennoot ? [beginVennoot] : []))
  const [mnd, setMnd] = useState(e?.maand ?? huidigeMaand)
  const [bedrag, setBedrag] = useState(e ? bedragTekst(e.bedrag) : '')
  const [reden, setReden] = useState(e?.reden ?? '')
  const [bezig, setBezig] = useState(false)
  const [akBezig, setAkBezig] = useState(false)
  const opties = useMemo(() => maandOpties(huidigeMaand, e?.maand), [huidigeMaand, e?.maand])
  const alleDrie = wie.length === VENNOTEN.length
  const zet = (k: Vennoot) => setWie((l) => (l.includes(k) ? l.filter((x) => x !== k) : VENNOTEN.filter((x) => x === k || l.includes(x))))
  const b = leesGetal(bedrag)
  const geldig = wie.length > 0 && b !== null && b > 0 && reden.trim().length >= 10
  const namen = VENNOTEN.filter((k) => wie.includes(k)).map((k) => data.namen[k])
  const stand = e ? extraStand(e, data.extraAkkoorden) : null
  const heeftAkkoord = !!e && data.extraAkkoorden.some((a) => a.extra_id === e.id)

  const bewaar = async () => {
    setBezig(true)
    try {
      await post({ actie: e ? 'extra.wijzig' : 'extra.nieuw', id: e?.id, vennoten: wie, maand: mnd, bedrag, reden })
      onKlaar(e ? 'Extra budget aangepast.' : 'Extra budget voorgesteld. Het telt mee zodra alle drie akkoord gaven.')
    } catch (x) { toast.error(x instanceof Error ? x.message : 'Bewaren mislukt'); setBezig(false) }
  }
  const akkoord = async () => {
    if (!e) return
    setAkBezig(true)
    try { await post({ actie: 'extra.akkoord', id: e.id }); onKlaar('Akkoord gegeven.') } catch (x) { toast.error(x instanceof Error ? x.message : 'Akkoord mislukt'); setAkBezig(false) }
  }

  return (
    <Venster titel={e ? 'Extra budget' : 'Extra budget toevoegen'} onSluit={onSluit}>
      <div>
        <span className={lbl}>Voor wie</span>
        <div className="grid grid-cols-3 gap-2">
          {VENNOTEN.map((k) => (
            <button key={k} type="button" onClick={() => zet(k)} aria-pressed={wie.includes(k)} className={`h-11 rounded-lg border text-sm font-medium inline-flex items-center justify-center gap-1.5 ${wie.includes(k) ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50'}`}>
              <PersoonFoto naam={data.namen[k]} maat={26} />{data.namen[k]}{wie.includes(k) && <Check className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setWie(alleDrie ? [] : [...VENNOTEN])} className="mt-2 text-xs underline text-gray-600">{alleDrie ? 'Niemand' : 'Alle drie'}</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={lbl}>Welke maand</span>
          <select className={`${inp} capitalize`} value={mnd} onChange={(x) => setMnd(x.target.value)}>
            {opties.map((m) => <option key={m} value={m}>{maand(m)}</option>)}
          </select>
        </label>
        <label className="block"><span className={lbl}>{wie.length > 1 ? 'Extra per vennoot (€)' : 'Extra (€)'}</span>
          <input inputMode="decimal" className={inp} value={bedrag} onChange={(x) => setBedrag(x.target.value)} placeholder="200" />
        </label>
      </div>
      <div className="flex gap-1.5 flex-wrap -mt-2">
        {[100, 200, 250, 500].map((n) => (
          <button key={n} type="button" onClick={() => setBedrag(String(n))} className={`text-xs px-2.5 py-1 rounded-full border ${b === n ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50'}`}>+{eurKort(n)}</button>
        ))}
      </div>
      <label className="block"><span className={lbl}>Waarom</span>
        <textarea rows={3} className={inp} value={reden} onChange={(x) => setReden(x.target.value)} maxLength={1000}
          placeholder="bv. Veel klantbezoeken in mei; we spraken af dat iedereen die maand € 500 extra mag." />
        {reden.trim().length > 0 && reden.trim().length < 10 && <span className="text-[11px] text-amber-700">Schrijf iets meer, zodat iedereen later nog weet waarom.</span>}
      </label>

      {wie.length > 0 && b !== null && b > 0 && (
        <div className="rounded-xl bg-gray-50 border border-gray-100 px-3.5 py-3 text-sm text-gray-800 space-y-1">
          <p><b className="font-semibold">{alleDrie ? 'Marco, Bram en Chiara krijgen' : `${namenLijst(namen)} ${wie.length === 1 ? 'krijgt' : 'krijgen'}`}{wie.length > 1 ? ' elk' : ''} {eurKort(b)} extra</b> in {maand(mnd)}{wie.length > 1 ? `, samen ${eurKort(b * wie.length)}` : ''}.</p>
          <p className="text-xs text-gray-500">Telt mee in het tegoed zodra alle drie akkoord gaven.{data.ik ? ' Door te bewaren ga jij al akkoord.' : ''}</p>
        </div>
      )}

      {e && stand && (
        <div className="space-y-1.5">
          <span className={lbl}>Akkoord</span>
          <AkkoordChips stand={stand} namen={data.namen} ik={data.ik} bezig={akBezig} onAkkoord={akkoord} />
          {heeftAkkoord && <p className="text-xs text-gray-500">Pas je iets aan, dan geven alle drie opnieuw akkoord.</p>}
          {e.created_by && <p className="text-[11px] text-gray-400">Voorgesteld door {e.created_by}{e.created_at ? ` op ${dag(e.created_at.slice(0, 10))}` : ''}</p>}
        </div>
      )}

      <button type="button" onClick={bewaar} disabled={bezig || !geldig} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{e ? 'Wijzigingen bewaren' : 'Voorstellen'}</button>
      {onSchrap && <button type="button" onClick={onSchrap} className="btn-secondary w-full justify-center text-sm"><Trash2 className="h-4 w-4" />Schrappen</button>}
    </Venster>
  )
}
