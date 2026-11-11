'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BookOpen, Check, FileText, History, Loader2, Pencil, ScrollText, X } from 'lucide-react'
import { HandtekeningVak } from '@/components/admin/handtekening-vak'
import { VENNOTEN, type Vennoot } from '@/lib/vesting-akkoord'
import {
  REGELSETS, tekenStandVoor, verschilMetVorige,
  type AlgemeneRegelsVersie, type RegelHandtekening, type RegelSet, type RegelsData,
} from '@/lib/regels-akkoord'

/**
 * Regels die Marco, Bram en Chiara samen tekenen. Eén scherm voor Uitgaven
 * vennoten en Vesting, zodat beide exact hetzelfde werken: lezen, aanpassen
 * (= nieuwe versie), tekenen met je eigen account en eerdere versies met wie
 * wanneer tekende.
 */

export type RegelsBegin = 'bekijk' | 'bewerk' | 'versies'
type VersieMetHandtekeningen = AlgemeneRegelsVersie & { handtekeningen: RegelHandtekening[] }

const eur = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })
const kortDatum = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })
const maandLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' })
const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900/15 focus:border-gray-900'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

async function stuur(set: RegelSet, body: Record<string, unknown>) {
  const r = await fetch(REGELSETS[set].api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
  return j
}

function Venster({ titel, onSluit, children }: { titel: string; onSluit: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onSluit() }
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc)
  }, [onSluit])
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 sm:p-4" onClick={onSluit}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={titel}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h3 className="font-semibold">{titel}</h3>
          <button type="button" onClick={onSluit} className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  )
}

/** Wie tekende (of nog niet), per vennoot, met de handtekening als die er is. */
function Tekenrij({ namen, stand }: { namen: Record<Vennoot, string>; stand: Record<Vennoot, RegelHandtekening | null> }) {
  return (
    <div className="rounded-xl border border-gray-200 divide-y divide-gray-100">
      {VENNOTEN.map((k) => {
        const h = stand[k]
        return (
          <div key={k} className="flex items-center gap-3 px-3 py-2">
            <span className="text-sm font-medium w-16">{namen[k]}</span>
            {h ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {h.handtekening && <img src={h.handtekening} alt={`Handtekening ${namen[k]}`} className="h-8 w-24 object-contain" />}
                <span className="text-xs text-green-700 ml-auto">getekend {kortDatum(h.getekend_op)}</span>
              </>
            ) : <span className="text-xs text-amber-700 ml-auto">nog niet getekend</span>}
          </div>
        )
      })}
    </div>
  )
}

/** De regels zelf: genummerd, met "nieuw" bij wat er tegenover de vorige versie bijkwam. */
function RegelsLijst({ v, vorige, metBudget }: { v: AlgemeneRegelsVersie; vorige: AlgemeneRegelsVersie | null; metBudget: boolean }) {
  const d = verschilMetVorige(v, vorige)
  return (
    <div className="space-y-2">
      <ol className="space-y-1.5 list-decimal pl-5 text-sm text-gray-800">
        {v.regels.map((x, i) => <li key={i} className="whitespace-pre-line">{x}{d.nieuw[i] && <span className="ml-1.5 align-middle text-[10px] font-semibold uppercase text-emerald-700 bg-emerald-50 rounded px-1 py-px">nieuw</span>}</li>)}
      </ol>
      {d.weg.length > 0 && (
        <div className="text-xs text-gray-500">
          Weg tegenover versie {vorige?.versie}:
          <ul className="mt-0.5 space-y-0.5">{d.weg.map((x, i) => <li key={i} className="line-through">{x}</li>)}</ul>
        </div>
      )}
      <p className="text-xs text-gray-500">
        {metBudget && v.maandbudget !== undefined && v.maandbudget !== null && v.start_maand && (
          <>Budget <span className={d.budget ? 'font-semibold text-gray-800' : ''}>{eur(Number(v.maandbudget))}</span> per vennoot per maand · tegoed telt vanaf <span className={d.start ? 'font-semibold text-gray-800' : ''}>{maandLabel(v.start_maand)}</span> · </>
        )}
        versie {v.versie}{v.created_at ? ` van ${kortDatum(v.created_at)}` : ''}{v.created_by ? ` door ${v.created_by}` : ''}
      </p>
    </div>
  )
}

/** Knop bovenaan de pagina: de regels lezen (en zien of jij nog moet tekenen). */
export function RegelsKnop({ set, data, onOpen }: { set: RegelSet; data: RegelsData; onOpen: (b: RegelsBegin) => void }) {
  const v = data.versie
  const stand = tekenStandVoor(set, v, data.handtekeningen)
  const ikMoet = !!v && !!data.ik && !stand[data.ik]
  if (!v) return <button type="button" onClick={() => onOpen('bewerk')} className="btn-secondary text-sm"><ScrollText className="h-4 w-4" />Regels opstellen</button>
  return (
    <button type="button" onClick={() => onOpen('bekijk')} className={`btn-secondary text-sm ${ikMoet ? '!border-amber-300 !bg-amber-50' : ''}`}
      title={stand.allen ? 'Getekend door alle drie' : `Wacht op ${VENNOTEN.filter((k) => !stand[k]).map((k) => data.namen[k]).join(', ')}`}>
      <BookOpen className="h-4 w-4" />Regels lezen
      {ikMoet ? <span className="text-[11px] font-semibold text-amber-800">· teken jij nog</span> : !stand.allen ? <span className="text-[11px] text-gray-500">· niet iedereen tekende</span> : null}
    </button>
  )
}

/** Altijd zichtbaar onderaan de pagina: de geldende regels, gewoon om te lezen. */
export function RegelsKaart({ set, data, onOpen }: { set: RegelSet; data: RegelsData; onOpen: (b: RegelsBegin) => void }) {
  const v = data.versie
  const stand = tekenStandVoor(set, v, data.handtekeningen)
  const ikMoet = !!v && !!data.ik && !stand[data.ik]
  return (
    <section className="card-base space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="font-semibold text-gray-900 flex items-center gap-1.5 flex-1 min-w-0"><ScrollText className="h-4 w-4" />De regels{v ? ` · versie ${v.versie}` : ''}</h2>
        {v && (
          <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${stand.allen ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
            {stand.allen ? 'getekend door alle drie' : `wacht op ${VENNOTEN.filter((k) => !stand[k]).map((k) => data.namen[k]).join(', ')}`}
          </span>
        )}
      </div>
      {v ? <RegelsLijst v={v} vorige={null} metBudget={REGELSETS[set].metBudget} /> : <p className="text-sm text-gray-500">Er zijn nog geen regels vastgelegd. Stel ze op; daarna tekenen Marco, Bram en Chiara alle drie.</p>}
      <div className="flex gap-2 flex-wrap">
        {ikMoet && <button type="button" onClick={() => onOpen('bekijk')} className="btn-primary text-sm"><FileText className="h-4 w-4" />Lezen en tekenen</button>}
        {v && <button type="button" onClick={() => onOpen('versies')} className="btn-secondary text-sm"><History className="h-4 w-4" />Eerdere versies en handtekeningen</button>}
        <button type="button" onClick={() => onOpen('bewerk')} className="btn-secondary text-sm"><Pencil className="h-4 w-4" />{v ? 'Regels aanpassen' : 'Regels opstellen'}</button>
      </div>
    </section>
  )
}

/** Elke versie, nieuwste eerst: wat er stond, wat veranderde en wie wanneer tekende. */
function Versies({ set, namen }: { set: RegelSet; namen: Record<Vennoot, string> }) {
  const [versies, setVersies] = useState<VersieMetHandtekeningen[] | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    let weg = false
    fetch(`${REGELSETS[set].api}?regels=alle`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Laden mislukt'); return j.versies as VersieMetHandtekeningen[] })
      .then((v) => { if (!weg) { setVersies(v); setOpen(v[0]?.id ?? null) } })
      .catch((e) => { if (!weg) setFout(e instanceof Error ? e.message : 'Laden mislukt') })
    return () => { weg = true }
  }, [set])
  if (fout) return <p className="text-sm text-red-700">{fout}</p>
  if (!versies) return <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Versies laden…</p>
  if (!versies.length) return <p className="text-sm text-gray-500">Nog geen versies.</p>
  return (
    <ul className="space-y-2">
      {versies.map((v, i) => {
        const vorige = versies[i + 1] ?? null
        const stand = tekenStandVoor(set, v, v.handtekeningen)
        const isOpen = open === v.id
        return (
          <li key={v.id} className="rounded-xl border border-gray-200">
            <button type="button" onClick={() => setOpen(isOpen ? null : v.id)} aria-expanded={isOpen} className="w-full flex items-center gap-2 px-3 py-2 text-left">
              <span className="text-sm font-semibold">Versie {v.versie}{i === 0 ? ' (geldt nu)' : ''}</span>
              <span className="text-xs text-gray-500">{v.created_at ? kortDatum(v.created_at) : ''}</span>
              <span className={`ml-auto text-[11px] font-semibold ${stand.allen ? 'text-green-700' : 'text-amber-700'}`}>{stand.allen ? 'alle drie getekend' : `${VENNOTEN.filter((k) => stand[k]).length} van 3 getekend`}</span>
            </button>
            {isOpen && (
              <div className="px-3 pb-3 space-y-3 border-t border-gray-100 pt-3">
                <RegelsLijst v={v} vorige={vorige} metBudget={REGELSETS[set].metBudget} />
                <Tekenrij namen={namen} stand={stand} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Het venster: lezen (met tekenen als jij nog moet), aanpassen (= nieuwe
 * versie die alle drie opnieuw tekenen) en eerdere versies.
 */
export function RegelsVenster({ set, data, begin, huidigeMaand, standaardRegels = [], standaardBudget = 250, onSluit, onKlaar }: {
  set: RegelSet; data: RegelsData; begin: RegelsBegin
  /** Enkel bij vennoten: standaard startmaand (JJJJ-MM). */
  huidigeMaand?: string
  standaardRegels?: string[]
  standaardBudget?: number
  onSluit: () => void
  onKlaar: (melding: string) => void
}) {
  const cfg = REGELSETS[set]
  const r = data.versie
  const stand = tekenStandVoor(set, r, data.handtekeningen)
  const [modus, setModus] = useState<RegelsBegin>(!r ? 'bewerk' : begin)
  const [tekst, setTekst] = useState((r?.regels ?? standaardRegels).join('\n'))
  const [budget, setBudget] = useState(String(r?.maandbudget ?? standaardBudget).replace('.', ','))
  const [start, setStart] = useState(r?.start_maand ?? huidigeMaand ?? '')
  const [png, setPng] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const ikMoet = !!r && !!data.ik && !stand[data.ik]

  const bewaar = async () => {
    setBezig(true)
    try {
      await stuur(set, cfg.metBudget ? { actie: 'regels', regels: tekst, maandbudget: budget, start_maand: start } : { actie: 'regels', regels: tekst })
      setModus('bekijk'); onKlaar('Nieuwe versie bewaard. Alle drie tekenen opnieuw.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  const tekenNu = async () => {
    if (!r || !png) return
    setBezig(true)
    try { await stuur(set, { actie: 'teken', id: r.id, handtekening: png }); onKlaar('Getekend.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Tekenen mislukt') } finally { setBezig(false) }
  }

  const titel = modus === 'versies' ? `${cfg.titel} · alle versies` : r && modus === 'bekijk' ? `${cfg.titel} · versie ${r.versie}` : r ? `${cfg.titel} aanpassen` : `${cfg.titel} opstellen`

  return (
    <Venster titel={titel} onSluit={onSluit}>
      {modus === 'versies' ? (
        <>
          <Versies set={set} namen={data.namen} />
          <button type="button" onClick={() => setModus('bekijk')} className="btn-secondary w-full text-sm">Terug naar de geldende regels</button>
        </>
      ) : modus === 'bewerk' ? (
        <>
          <label className="block"><span className={lbl}>Regels (één per lijn)</span>
            <textarea rows={10} className={inp} value={tekst} onChange={(e) => setTekst(e.target.value)} placeholder={'Bv.\nWat telt mee voor de vesting…\nWanneer we een contract niet meetellen…'} autoFocus />
          </label>
          {cfg.metBudget && (
            <div className="grid grid-cols-2 gap-3">
              <label className="block"><span className={lbl}>Budget per vennoot per maand (€)</span><input inputMode="decimal" className={inp} value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
              <label className="block"><span className={lbl}>Tegoed telt vanaf</span><input type="month" className={inp} value={start} onChange={(e) => setStart(e.target.value)} /></label>
            </div>
          )}
          <p className="text-xs text-gray-500">Bewaren maakt een nieuwe versie. Daarna tekenen Marco, Bram en Chiara alle drie opnieuw, elk met hun eigen account.</p>
          <div className="flex gap-2">
            <button type="button" onClick={bewaar} disabled={bezig || !tekst.trim()} className="btn-primary flex-1">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Bewaren als nieuwe versie</button>
            {r && <button type="button" onClick={() => setModus('bekijk')} className="btn-secondary">Annuleer</button>}
          </div>
        </>
      ) : r && (
        <>
          <RegelsLijst v={r} vorige={null} metBudget={cfg.metBudget} />
          <Tekenrij namen={data.namen} stand={stand} />
          {ikMoet && (
            <div className="space-y-2">
              <span className={lbl}>Jouw handtekening</span>
              <HandtekeningVak onChange={setPng} hoogte={130} />
              <button type="button" onClick={tekenNu} disabled={bezig || !png} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}Akkoord en tekenen</button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" onClick={() => setModus('versies')} className="btn-secondary text-sm"><History className="h-4 w-4" />Eerdere versies</button>
            <button type="button" onClick={() => setModus('bewerk')} className="btn-secondary text-sm"><Pencil className="h-4 w-4" />Aanpassen</button>
          </div>
        </>
      )}
    </Venster>
  )
}
