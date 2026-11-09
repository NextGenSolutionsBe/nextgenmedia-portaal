'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Archive, Check, ChevronLeft, ChevronRight, FileText, History, Loader2, Paperclip, Pencil, Plus, RotateCcw, ScrollText, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { HandtekeningVak } from '@/components/admin/handtekening-vak'
import {
  VENNOTEN, REDEN_VOORSTEL, STANDAARD_REGELS, budgetVan, maandLabel, periodeVan, regelsVerschil, standPerVennoot, tekenStand, uitgavenIn, verschuif,
  type Periode, type PeriodeSoort, type RegelsVersie, type RegelHandtekening, type Uitgave, type Vennoot,
} from '@/lib/vennoot-uitgaven'
import type { RegelsMetHandtekeningen, VennotenData } from '@/lib/vennoot-uitgaven-server'

const eur = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR' })
const dag = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })
const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900/15 focus:border-gray-900'
const lbl = 'block text-xs font-medium text-gray-600 mb-1'

async function post(body: Record<string, unknown>) {
  const r = await fetch('/api/admin/vennoten', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
  return j
}

/**
 * Uitgaven vennoten. Bovenaan per vennoot het tegoed (opgespaard budget min wat
 * al besteed is) en wat er in de gekozen periode uitging; klik op een vennoot
 * voor enkel zijn of haar uitgaven. "+ Uitgave" met bonnetje (foto of pdf),
 * archiveren met een verantwoording, en de regels die alle drie tekenen.
 */
export function VennotenClient({ data, vandaag, beginVennoot, regelsOpen }: { data: VennotenData; vandaag: string; beginVennoot: Vennoot | null; regelsOpen: boolean }) {
  const router = useRouter()
  const huidigeMaand = vandaag.slice(0, 7)
  const [soort, setSoort] = useState<PeriodeSoort | 'alles'>('maand')
  const [periode, setPeriode] = useState<Periode>(() => periodeVan('maand', huidigeMaand))
  const [vennoot, setVennoot] = useState<Vennoot | null>(beginVennoot)
  const [archief, setArchief] = useState(false)
  const [bewerk, setBewerk] = useState<Uitgave | 'nieuw' | null>(null)
  const [archiveer, setArchiveer] = useState<Uitgave | null>(null)
  const [regels, setRegels] = useState<RegelsBegin | null>(regelsOpen ? 'bekijk' : null)

  const budget = budgetVan(data.regels, data.uitgaven, huidigeMaand)
  const alles = soort === 'alles'
  const stand = useMemo(() => standPerVennoot(data.uitgaven, budget, periode, huidigeMaand), [data.uitgaven, budget, periode, huidigeMaand])
  const lijst = useMemo(() => uitgavenIn(data.uitgaven, alles ? null : periode, vennoot, archief), [data.uitgaven, alles, periode, vennoot, archief])
  const aantalArchief = useMemo(() => uitgavenIn(data.uitgaven, alles ? null : periode, vennoot, true).length, [data.uitgaven, alles, periode, vennoot])
  const totaal = lijst.reduce((s, u) => s + u.bedrag, 0)
  const teken = tekenStand(data.regels, data.handtekeningen)
  const label = alles ? 'alle periodes' : periode.label

  const kiesSoort = (s: PeriodeSoort | 'alles') => { setSoort(s); if (s !== 'alles') setPeriode(periodeVan(s, periode.ref > huidigeMaand ? huidigeMaand : periode.ref)) }
  const klaar = (melding: string) => { toast.success(melding); router.refresh() }

  const regelsKnop = !data.regels ? 'Regels opstellen'
    : teken.allen ? 'Regels · getekend door alle drie'
    : data.ik && !teken[data.ik] ? 'Regels · teken jij nog'
    : `Regels · wacht op ${VENNOTEN.filter((k) => !teken[k]).map((k) => data.namen[k]).join(', ')}`

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold">Uitgaven vennoten</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">Aankopen op de zaak die één vennoot persoonlijk voordeel geven. {eur(budget.maandbudget)} per vennoot per maand; wat je niet gebruikt, spaar je.</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button type="button" onClick={() => setRegels('bekijk')} className={`btn-secondary text-sm ${data.regels && !teken.allen ? '!border-amber-300 !bg-amber-50' : ''}`}><ScrollText className="h-4 w-4" />{regelsKnop}</button>
          <button type="button" onClick={() => setBewerk('nieuw')} className="btn-primary text-sm"><Plus className="h-4 w-4" />Uitgave</button>
        </div>
      </div>

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
            <span className="text-sm font-semibold min-w-[8rem] text-center capitalize">{periode.label}</span>
            <button type="button" onClick={() => setPeriode((p) => verschuif(p, 1))} disabled={periode.maanden.includes(huidigeMaand) || periode.ref > huidigeMaand} className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-gray-100 disabled:opacity-30" aria-label="Volgende periode"><ChevronRight className="h-4 w-4" /></button>
            {!periode.maanden.includes(huidigeMaand) && <button type="button" onClick={() => setPeriode(periodeVan(soort as PeriodeSoort, huidigeMaand))} className="text-xs text-gray-500 underline ml-1">Nu</button>}
          </div>
        )}
      </div>

      {/* Per vennoot */}
      <div className="grid gap-3 sm:grid-cols-3">
        {stand.map((s) => {
          const besteed = alles ? s.besteedTotaal : s.besteedPeriode
          const max = alles ? s.budgetTotaal : s.budgetPeriode
          const pct = max > 0 ? Math.min(100, Math.round((besteed / max) * 100)) : besteed > 0 ? 100 : 0
          const aan = vennoot === s.vennoot
          return (
            <button key={s.vennoot} type="button" onClick={() => setVennoot(aan ? null : s.vennoot)} aria-pressed={aan}
              className={`card-base text-left space-y-2 transition ${aan ? 'ring-2 ring-gray-900' : 'hover:border-gray-300'}`}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-semibold text-gray-900">{data.namen[s.vennoot]}</span>
                <span className="text-[11px] text-gray-500">{aan ? 'geopend' : 'openen'}</span>
              </div>
              <div>
                <div className="text-[11px] text-gray-500">Tegoed vandaag</div>
                <div className={`text-2xl font-semibold tabular-nums ${s.tegoed < 0 ? 'text-red-600' : 'text-green-700'}`}>{eur(s.tegoed)}</div>
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-600"><span>Besteed in {label}</span><span className="tabular-nums">{eur(besteed)} van {eur(max)}</span></div>
                <div className="h-1.5 rounded-full bg-gray-100 mt-1 overflow-hidden"><div className={`h-1.5 rounded-full ${besteed > max ? 'bg-red-500' : 'bg-gray-900'}`} style={{ width: `${pct}%` }} /></div>
              </div>
              <div className="text-[11px] text-gray-500">In totaal besteed: {eur(s.besteedTotaal)}</div>
            </button>
          )
        })}
      </div>

      {/* Lijst */}
      <section className="card-base !p-0 overflow-hidden">
        <div className="flex items-center gap-2 flex-wrap px-4 py-3 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900 flex-1 min-w-0">
            {vennoot ? `${data.namen[vennoot]}: ` : 'Alle vennoten: '}{archief ? 'gearchiveerd' : 'uitgaven'} in {label}
          </h2>
          {vennoot && <button type="button" onClick={() => setVennoot(null)} className="text-xs px-2.5 py-1 rounded-full border border-gray-200 hover:bg-gray-50 inline-flex items-center gap-1"><X className="h-3 w-3" />Alle vennoten</button>}
          <button type="button" onClick={() => setArchief((a) => !a)} aria-pressed={archief} className={`text-xs px-2.5 py-1 rounded-full border inline-flex items-center gap-1 ${archief ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50'}`}><Archive className="h-3 w-3" />Archief ({aantalArchief})</button>
        </div>
        {lijst.length === 0 ? <p className="px-4 py-8 text-sm text-gray-500 text-center">{archief ? 'Niets gearchiveerd in deze periode.' : 'Geen uitgaven in deze periode.'}</p> : (
          <ul className="divide-y divide-gray-100">
            {lijst.map((u) => (
              <li key={u.id} className="px-4 py-3 flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
                    <span className="tabular-nums">{dag(u.datum)}</span>
                    {!vennoot && <span className="inline-flex text-[11px] font-semibold text-gray-800 rounded-full bg-gray-100 px-2 py-0.5">{data.namen[u.vennoot]}</span>}
                    {u.bewijs_pad
                      ? <a href={`/api/admin/vennoten/bon?pad=${encodeURIComponent(u.bewijs_pad)}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-gray-600 hover:text-black" title={u.bewijs_naam ?? 'Bonnetje'}><Paperclip className="h-3.5 w-3.5" />Bon</a>
                      : <span className="text-amber-700">geen bon</span>}
                  </div>
                  <div className="text-sm font-medium text-gray-900 mt-0.5">{u.omschrijving}</div>
                  {u.doel && <div className="text-xs text-gray-500 mt-0.5">{u.doel}</div>}
                  {u.gearchiveerd_op && <div className="text-xs text-amber-800 mt-1">Gearchiveerd{u.gearchiveerd_door ? ` door ${u.gearchiveerd_door}` : ''}: {u.archief_reden}</div>}
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <div className="text-sm font-semibold tabular-nums">{eur(u.bedrag)}</div>
                  <div className="flex items-center gap-0.5">
                    {u.gearchiveerd_op ? (
                      <button type="button" onClick={async () => { try { await post({ actie: 'terugzetten', id: u.id }); klaar('Teruggezet.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } }} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Terugzetten"><RotateCcw className="h-4 w-4" /></button>
                    ) : (
                      <>
                        <button type="button" onClick={() => setBewerk(u)} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Aanpassen"><Pencil className="h-4 w-4" /></button>
                        <button type="button" onClick={() => setArchiveer(u)} className="h-8 w-8 rounded-lg flex items-center justify-center text-gray-500 hover:bg-gray-100" title="Archiveren"><Archive className="h-4 w-4" /></button>
                      </>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
        {lijst.length > 0 && <div className="px-4 py-3 border-t border-gray-100 flex justify-between text-sm"><span className="text-gray-600">{lijst.length} {lijst.length === 1 ? 'uitgave' : 'uitgaven'}</span><span className="font-semibold tabular-nums">{eur(totaal)}</span></div>}
      </section>

      <RegelsKaart data={data} onOpen={setRegels} />

      {bewerk && <UitgaveVenster u={bewerk === 'nieuw' ? null : bewerk} beginVennoot={vennoot ?? data.ik} namen={data.namen} vandaag={vandaag} onSluit={() => setBewerk(null)} onKlaar={(m) => { setBewerk(null); klaar(m) }} />}
      {archiveer && <ArchiefVenster u={archiveer} naam={data.namen[archiveer.vennoot]} onSluit={() => setArchiveer(null)} onKlaar={() => { setArchiveer(null); klaar('Gearchiveerd. Telt niet meer mee.') }} />}
      {regels && <RegelsVenster data={data} huidigeMaand={huidigeMaand} begin={regels} onSluit={() => setRegels(null)} onKlaar={(m) => klaar(m)} />}
    </div>
  )
}

function Venster({ titel, onSluit, children }: { titel: string; onSluit: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/30 sm:p-4" onClick={onSluit}>
      <div className="bg-white w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl shadow-xl max-h-[92dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={titel}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold">{titel}</h3>
          <button type="button" onClick={onSluit} className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-4">{children}</div>
      </div>
    </div>
  )
}

function UitgaveVenster({ u, beginVennoot, namen, vandaag, onSluit, onKlaar }: { u: Uitgave | null; beginVennoot: Vennoot | null; namen: Record<Vennoot, string>; vandaag: string; onSluit: () => void; onKlaar: (m: string) => void }) {
  const [v, setV] = useState({ vennoot: u?.vennoot ?? beginVennoot ?? ('' as Vennoot | ''), omschrijving: u?.omschrijving ?? '', doel: u?.doel ?? '', datum: u?.datum ?? vandaag, bedrag: u ? String(u.bedrag).replace('.', ',') : '' })
  const [bon, setBon] = useState<{ pad: string; naam: string } | null>(null)
  const [laden, setLaden] = useState(false)
  const [bezig, setBezig] = useState(false)
  const kiezer = useRef<HTMLInputElement>(null)

  const laadBonOp = async (f?: File) => {
    if (!f) return
    if (f.size > 25 * 1024 * 1024) { toast.error('Het bestand is groter dan 25 MB.'); return }
    setLaden(true)
    try {
      const naam = f.name && /\.[a-z0-9]+$/i.test(f.name) ? f.name : `bon.${(f.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')}`
      const r = await fetch('/api/admin/vennoten/bon', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ naam, grootte: f.size }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Opladen mislukt')
      const { error } = await createClient().storage.from(j.bucket).uploadToSignedUrl(j.pad, j.token, f, { contentType: j.contentType, upsert: false })
      if (error) throw new Error(error.message)
      setBon({ pad: j.pad, naam })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opladen mislukt') } finally { setLaden(false); if (kiezer.current) kiezer.current.value = '' }
  }
  const bewaar = async () => {
    setBezig(true)
    try {
      await post({ actie: u ? 'wijzig' : 'nieuw', id: u?.id, ...v, bon })
      onKlaar(u ? 'Uitgave aangepast.' : 'Uitgave bewaard.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt'); setBezig(false) }
  }

  return (
    <Venster titel={u ? 'Uitgave aanpassen' : 'Nieuwe uitgave'} onSluit={onSluit}>
      <div>
        <span className={lbl}>Voor wie</span>
        <div className="grid grid-cols-3 gap-2">
          {VENNOTEN.map((k) => (
            <button key={k} type="button" onClick={() => setV({ ...v, vennoot: k })} aria-pressed={v.vennoot === k} className={`h-10 rounded-lg border text-sm font-medium ${v.vennoot === k ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50'}`}>{namen[k]}</button>
          ))}
        </div>
      </div>
      <label className="block"><span className={lbl}>Wat</span><input className={inp} value={v.omschrijving} onChange={(e) => setV({ ...v, omschrijving: e.target.value })} placeholder="bv. Fiets, broodje bij klantbezoek" maxLength={200} /></label>
      <label className="block"><span className={lbl}>Waarvoor dient het</span><textarea rows={2} className={inp} value={v.doel} onChange={(e) => setV({ ...v, doel: e.target.value })} placeholder="bv. Woon-werkverkeer, lunch tijdens bezoek bij Era Nobis" maxLength={500} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block"><span className={lbl}>Wanneer</span><input type="date" className={inp} value={v.datum} max={vandaag} onChange={(e) => setV({ ...v, datum: e.target.value })} /></label>
        <label className="block"><span className={lbl}>Bedrag (€, incl. btw)</span><input inputMode="decimal" className={inp} value={v.bedrag} onChange={(e) => setV({ ...v, bedrag: e.target.value })} placeholder="0,00" /></label>
      </div>
      <div>
        <span className={lbl}>Bonnetje of factuur</span>
        <input ref={kiezer} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => laadBonOp(e.target.files?.[0])} />
        <button type="button" onClick={() => kiezer.current?.click()} disabled={laden} className="btn-secondary text-sm w-full justify-center">
          {laden ? <Loader2 className="h-4 w-4 animate-spin" /> : bon ? <Check className="h-4 w-4 text-green-600" /> : <Paperclip className="h-4 w-4" />}
          {bon ? bon.naam : u?.bewijs_pad ? 'Ander bonnetje kiezen' : 'Foto trekken of bestand kiezen'}
        </button>
        <p className="text-[11px] text-gray-500 mt-1">Op je gsm kan je meteen een foto trekken. Een pdf van een factuur kan ook.</p>
      </div>
      <button type="button" onClick={bewaar} disabled={bezig || laden || !v.vennoot} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Bewaren</button>
    </Venster>
  )
}

function ArchiefVenster({ u, naam, onSluit, onKlaar }: { u: Uitgave; naam: string; onSluit: () => void; onKlaar: () => void }) {
  const [reden, setReden] = useState('')
  const [bezig, setBezig] = useState(false)
  const doe = async () => {
    setBezig(true)
    try { await post({ actie: 'archiveer', id: u.id, reden }); onKlaar() } catch (e) { toast.error(e instanceof Error ? e.message : 'Archiveren mislukt'); setBezig(false) }
  }
  return (
    <Venster titel="Uitgave archiveren" onSluit={onSluit}>
      <p className="text-sm text-gray-700"><b className="font-semibold">{naam}</b> · {u.omschrijving} · {eur(u.bedrag)}</p>
      <p className="text-xs text-gray-500">Een gearchiveerde uitgave telt niet meer mee voor het tegoed. Ze blijft zichtbaar in het archief, met de reden erbij.</p>
      <label className="block"><span className={lbl}>Verantwoording</span><textarea rows={3} className={inp} value={reden} onChange={(e) => setReden(e.target.value)} maxLength={500} placeholder="Waarom archiveer je deze uitgave?" /></label>
      <button type="button" onClick={() => setReden(REDEN_VOORSTEL)} className="text-xs px-2.5 py-1 rounded-full border border-gray-200 hover:bg-gray-50 text-left">{REDEN_VOORSTEL}</button>
      <button type="button" onClick={doe} disabled={bezig || reden.trim().length < 3} className="btn-primary w-full">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Archive className="h-4 w-4" />}Archiveren</button>
    </Venster>
  )
}

type RegelsBegin = 'bekijk' | 'bewerk' | 'versies'

const kortDatum = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })

/** Wie tekende (of nog niet), per vennoot. Met de handtekening als die er is. */
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
function RegelsLijst({ v, vorige }: { v: RegelsVersie; vorige: RegelsVersie | null }) {
  const d = regelsVerschil(v, vorige)
  return (
    <div className="space-y-2">
      <ol className="space-y-1.5 list-decimal pl-5 text-sm text-gray-800">
        {v.regels.map((x, i) => <li key={i}>{x}{d.nieuw[i] && <span className="ml-1.5 align-middle text-[10px] font-semibold uppercase text-emerald-700 bg-emerald-50 rounded px-1 py-px">nieuw</span>}</li>)}
      </ol>
      {d.weg.length > 0 && (
        <div className="text-xs text-gray-500">
          Weg tegenover versie {vorige?.versie}:
          <ul className="mt-0.5 space-y-0.5">{d.weg.map((x, i) => <li key={i} className="line-through">{x}</li>)}</ul>
        </div>
      )}
      <p className="text-xs text-gray-500">
        Budget <span className={d.budget ? 'font-semibold text-gray-800' : ''}>{eur(v.maandbudget)}</span> per vennoot per maand · tegoed telt vanaf <span className={d.start ? 'font-semibold text-gray-800' : ''}>{maandLabel(v.start_maand)}</span>
        {v.created_at && <> · versie {v.versie} van {kortDatum(v.created_at)}{v.created_by ? ` door ${v.created_by}` : ''}</>}
      </p>
    </div>
  )
}

/** Altijd zichtbaar onderaan de pagina: de geldende regels, gewoon om te lezen. */
function RegelsKaart({ data, onOpen }: { data: VennotenData; onOpen: (b: RegelsBegin) => void }) {
  const r = data.regels
  const stand = tekenStand(r, data.handtekeningen)
  const ikMoet = !!r && !!data.ik && !stand[data.ik]
  return (
    <section className="card-base space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <h2 className="font-semibold text-gray-900 flex items-center gap-1.5 flex-1 min-w-0"><ScrollText className="h-4 w-4" />De regels{r ? ` · versie ${r.versie}` : ''}</h2>
        {r && (
          <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${stand.allen ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
            {stand.allen ? 'getekend door alle drie' : `wacht op ${VENNOTEN.filter((k) => !stand[k]).map((k) => data.namen[k]).join(', ')}`}
          </span>
        )}
      </div>
      {r ? <RegelsLijst v={r} vorige={null} /> : <p className="text-sm text-gray-500">Er zijn nog geen regels vastgelegd.</p>}
      <div className="flex gap-2 flex-wrap">
        {ikMoet && <button type="button" onClick={() => onOpen('bekijk')} className="btn-primary text-sm"><FileText className="h-4 w-4" />Lezen en tekenen</button>}
        {r && <button type="button" onClick={() => onOpen('versies')} className="btn-secondary text-sm"><History className="h-4 w-4" />Eerdere versies en handtekeningen</button>}
        <button type="button" onClick={() => onOpen('bewerk')} className="btn-secondary text-sm"><Pencil className="h-4 w-4" />{r ? 'Regels aanpassen' : 'Regels opstellen'}</button>
      </div>
    </section>
  )
}

/** Elke versie, nieuwste eerst: wat er stond, wat veranderde en wie wanneer tekende. */
function Versies({ namen }: { namen: Record<Vennoot, string> }) {
  const [versies, setVersies] = useState<RegelsMetHandtekeningen[] | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  useEffect(() => {
    let weg = false
    fetch('/api/admin/vennoten?regels=alle', { cache: 'no-store' })
      .then(async (r) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Laden mislukt'); return j.versies as RegelsMetHandtekeningen[] })
      .then((v) => { if (!weg) { setVersies(v); setOpen(v[0]?.id ?? null) } })
      .catch((e) => { if (!weg) setFout(e instanceof Error ? e.message : 'Laden mislukt') })
    return () => { weg = true }
  }, [])
  if (fout) return <p className="text-sm text-red-700">{fout}</p>
  if (!versies) return <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Versies laden…</p>
  if (!versies.length) return <p className="text-sm text-gray-500">Nog geen versies.</p>
  return (
    <ul className="space-y-2">
      {versies.map((v, i) => {
        const vorige = versies[i + 1] ?? null
        const stand = tekenStand(v, v.handtekeningen)
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
                <RegelsLijst v={v} vorige={vorige} />
                <Tekenrij namen={namen} stand={stand} />
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

function RegelsVenster({ data, huidigeMaand, begin, onSluit, onKlaar }: { data: VennotenData; huidigeMaand: string; begin: RegelsBegin; onSluit: () => void; onKlaar: (m: string) => void }) {
  const r = data.regels
  const stand = tekenStand(r, data.handtekeningen)
  const [modus, setModus] = useState<RegelsBegin>(!r ? 'bewerk' : begin)
  const bewerk = modus === 'bewerk'
  const setBewerk = (b: boolean) => setModus(b ? 'bewerk' : 'bekijk')
  const [tekst, setTekst] = useState((r?.regels ?? STANDAARD_REGELS).join('\n'))
  const [budget, setBudget] = useState(String(r?.maandbudget ?? 250).replace('.', ','))
  const [start, setStart] = useState(r?.start_maand ?? huidigeMaand)
  const [png, setPng] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)
  const ikMoet = !!r && !!data.ik && !stand[data.ik]

  const bewaar = async () => {
    setBezig(true)
    try { await post({ actie: 'regels', regels: tekst, maandbudget: budget, start_maand: start }); setBewerk(false); onKlaar('Nieuwe versie bewaard. Alle drie tekenen opnieuw.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }
  const tekenNu = async () => {
    if (!r || !png) return
    setBezig(true)
    try { await post({ actie: 'teken', id: r.id, handtekening: png }); onKlaar('Getekend.') } catch (e) { toast.error(e instanceof Error ? e.message : 'Tekenen mislukt') } finally { setBezig(false) }
  }

  return (
    <Venster titel={modus === 'versies' ? 'Alle versies van de regels' : r ? `Regels · versie ${r.versie}` : 'Regels opstellen'} onSluit={onSluit}>
      {modus === 'versies' ? (
        <>
          <Versies namen={data.namen} />
          <button type="button" onClick={() => setModus('bekijk')} className="btn-secondary w-full text-sm">Terug naar de geldende regels</button>
        </>
      ) : bewerk ? (
        <>
          <label className="block"><span className={lbl}>Regels (één per lijn)</span><textarea rows={8} className={inp} value={tekst} onChange={(e) => setTekst(e.target.value)} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className={lbl}>Budget per vennoot per maand (€)</span><input inputMode="decimal" className={inp} value={budget} onChange={(e) => setBudget(e.target.value)} /></label>
            <label className="block"><span className={lbl}>Tegoed telt vanaf</span><input type="month" className={inp} value={start} onChange={(e) => setStart(e.target.value)} /></label>
          </div>
          <p className="text-xs text-gray-500">Bewaren maakt een nieuwe versie. Daarna tekenen Marco, Bram en Chiara alle drie opnieuw.</p>
          <div className="flex gap-2">
            <button type="button" onClick={bewaar} disabled={bezig} className="btn-primary flex-1">{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Bewaren als nieuwe versie</button>
            {r && <button type="button" onClick={() => setBewerk(false)} className="btn-secondary">Annuleer</button>}
          </div>
        </>
      ) : r && (
        <>
          <RegelsLijst v={r} vorige={null} />
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
            <button type="button" onClick={() => setBewerk(true)} className="btn-secondary text-sm"><Pencil className="h-4 w-4" />Aanpassen</button>
          </div>
        </>
      )}
    </Venster>
  )
}
