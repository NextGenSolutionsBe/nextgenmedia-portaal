'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Legend } from 'recharts'
import { ArrowUpRight, ArrowDownRight, Minus, X, Loader2, ExternalLink, Repeat, Info, ChevronUp, ChevronDown } from 'lucide-react'
import { ExportKnop } from '@/components/admin/export-knop'
import type { Werkmap } from '@/lib/excel/spec'
import { DIENST_LABELS, DOORGEREKEND, NIET_GECATEGORISEERD, dienstLabel } from '@/lib/omzet/diensten'
import {
  filter as filterFeiten, totalen, groepeer, evolutie, facturen, periodeVan, vorigePeriode,
  type Feit, type FeitStatus, type Gran, type Groep, type Periode,
} from '@/lib/omzet/analyse'

/**
 * Omzetrapportage — live uit de facturenmodule. Bedragen excl. btw, in centen
 * berekend. Gefactureerd op factuurdatum, ontvangen op betaaldatum.
 * Alle filters werken samen en herberekenen KPI's, grafieken en tabellen meteen.
 */

type Data = { feiten: Feit[]; klanten: Record<string, string>; verwachteMrr: number; nuMaand: string; gepland: number; vandaag: string }
type Drill = { soort: 'dienst' | 'klant'; sleutel: string } | null

const EUR = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' })
const EUR0 = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const eur = (cent: number) => EUR.format(cent / 100)
const eur0 = (cent: number) => EUR0.format(cent / 100)
const pct = (p: number | null) => (p === null ? '—' : `${p > 0 ? '+' : ''}${p.toLocaleString('nl-BE', { maximumFractionDigits: 1 })}%`)
const datumKort = (d: string) => d.split('-').reverse().join('/')

// Vaste kleur per dienst (gevalideerd standaardpalet, volgorde vast — nooit op rang).
const KLEUR: Record<string, string> = {
  'social-media': '#2a78d6', webdesign: '#eb6834', 'marketing-consultancy': '#1baf7a', 'grafisch-ontwerp': '#eda100',
  ads: '#e87ba4', 'foto-video': '#008300', [DOORGEREKEND]: '#4a3aa7', [NIET_GECATEGORISEERD]: '#8a8984',
}
const ALLE_DIENSTEN = [...Object.keys(DIENST_LABELS), DOORGEREKEND, NIET_GECATEGORISEERD]
const STATUS_LABEL: Record<FeitStatus, string> = { betaald: 'Betaald', gedeeltelijk: 'Gedeeltelijk betaald', open: 'Openstaand', gecrediteerd: 'Gecrediteerd' }
const PRESETS: [string, string][] = [['deze_maand', 'Deze maand'], ['vorige_maand', 'Vorige maand'], ['dit_kwartaal', 'Dit kwartaal'], ['vorig_kwartaal', 'Vorig kwartaal'], ['dit_jaar', 'Dit jaar'], ['vorig_jaar', 'Vorig jaar'], ['laatste_12', 'Laatste 12 maanden']]
const sel = 'rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm'
const bucketLabel = (b: string) => /^\d{4}-\d{2}$/.test(b) ? `${['jan', 'feb', 'mrt', 'apr', 'mei', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'][Number(b.slice(5)) - 1]} ${b.slice(2, 4)}` : b.replace('-', ' ')

function Groei({ p, verschil }: { p: number | null; verschil?: number }) {
  if (p === null) return <span className="text-gray-400 text-xs">geen vergelijking</span>
  const Icon = p > 0 ? ArrowUpRight : p < 0 ? ArrowDownRight : Minus
  return <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${p > 0 ? 'text-green-700' : p < 0 ? 'text-red-700' : 'text-gray-600'}`}><Icon className="h-3.5 w-3.5" aria-hidden />{pct(p)}{verschil !== undefined && <span className="text-gray-500 font-normal ml-1">({verschil >= 0 ? '+' : '−'}{eur0(Math.abs(verschil))})</span>}</span>
}

function Kpi({ titel, waarde, sub, uitleg }: { titel: string; waarde: string; sub?: React.ReactNode; uitleg: string }) {
  return (
    <div className="card-base p-3 min-w-0">
      <div className="text-[11px] text-gray-500 flex items-center gap-1">{titel}<span title={uitleg} aria-label={uitleg} className="text-gray-400 cursor-help"><Info className="h-3 w-3" /></span></div>
      <div className="text-xl font-semibold tabular-nums mt-0.5 truncate">{waarde}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

type Kol<T> = { kop: string; waarde: (r: T) => number | string; toon: (r: T) => React.ReactNode; rechts?: boolean }
function Tabel<T extends { sleutel: string }>({ rijen, kolommen, onKlik, standaard = 1 }: { rijen: T[]; kolommen: Kol<T>[]; onKlik?: (r: T) => void; standaard?: number }) {
  const [sort, setSort] = useState<{ i: number; asc: boolean }>({ i: standaard, asc: false })
  const gesorteerd = [...rijen].sort((a, b) => { const x = kolommen[sort.i].waarde(a), y = kolommen[sort.i].waarde(b); const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'nl'); return sort.asc ? r : -r })
  return (
    <>
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] text-gray-500 border-b border-gray-200">
            {kolommen.map((k, i) => <th key={k.kop} className={`px-2 py-2 font-medium ${k.rechts ? 'text-right' : 'text-left'}`}><button type="button" onClick={() => setSort({ i, asc: sort.i === i ? !sort.asc : false })} className="inline-flex items-center gap-0.5 hover:text-gray-900">{k.kop}{sort.i === i && (sort.asc ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />)}</button></th>)}
          </tr></thead>
          <tbody className="divide-y divide-gray-100">
            {gesorteerd.map((r) => <tr key={r.sleutel} onClick={() => onKlik?.(r)} className={onKlik ? 'cursor-pointer hover:bg-gray-50' : ''}>{kolommen.map((k) => <td key={k.kop} className={`px-2 py-2 ${k.rechts ? 'text-right tabular-nums' : ''}`}>{k.toon(r)}</td>)}</tr>)}
          </tbody>
        </table>
      </div>
      <div className="md:hidden space-y-2">
        {gesorteerd.map((r) => (
          <button key={r.sleutel} type="button" onClick={() => onKlik?.(r)} className="w-full text-left rounded-lg border border-gray-200 p-2.5">
            <div className="font-medium text-sm">{kolommen[0].toon(r)}</div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 mt-1 text-xs">{kolommen.slice(1).map((k) => <div key={k.kop} className="contents"><dt className="text-gray-500">{k.kop}</dt><dd className="text-right tabular-nums">{k.toon(r)}</dd></div>)}</dl>
          </button>
        ))}
      </div>
      {!rijen.length && <p className="text-sm text-gray-400 py-4 text-center">Geen omzet in deze selectie.</p>}
    </>
  )
}

export function RapportageClient() {
  const [data, setData] = useState<Data | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const [preset, setPreset] = useState('dit_jaar')
  const [specifiek, setSpecifiek] = useState('')
  const [van, setVan] = useState(''); const [tot, setTot] = useState('')
  const [dienst, setDienst] = useState(''); const [klant, setKlant] = useState('')
  const [status, setStatus] = useState<FeitStatus | ''>(''); const [type, setType] = useState<'' | 'eenmalig' | 'terugkerend'>('')
  const [gran, setGran] = useState<Gran>('maand')
  const [lijnen, setLijnen] = useState<string[]>([])
  const [toonTotaal, setToonTotaal] = useState(true)
  const [drill, setDrill] = useState<Drill>(null)

  const laad = useCallback(async () => {
    try { const r = await fetch('/api/admin/revenue/analyse', { cache: 'no-store' }); const j = await r.json(); if (!r.ok) throw new Error(j.error); setData(j); setFout(null) } catch (e) { setFout(e instanceof Error ? e.message : 'Laden mislukt') }
  }, [])
  useEffect(() => { laad() }, [laad])

  const vandaag = data?.vandaag ?? new Date().toISOString().slice(0, 10)
  const sleutel = preset === 'specifiek' && specifiek ? specifiek : preset === 'aangepast' && van && tot ? `aangepast:${van}:${tot}` : preset
  const P: Periode = periodeVan(sleutel, vandaag)
  const V: Periode = vorigePeriode(P)
  const f = useMemo(() => filterFeiten(data?.feiten ?? [], { dienst: dienst || null, klant: klant || null, status: status || null, type: type || null }), [data, dienst, klant, status, type])
  const t = useMemo(() => totalen(f, P), [f, P.van, P.tot]) // eslint-disable-line react-hooks/exhaustive-deps
  const tv = useMemo(() => totalen(f, V), [f, V.van, V.tot]) // eslint-disable-line react-hooks/exhaustive-deps
  const perDienst = useMemo(() => groepeer(f, P, V, 'dienst'), [f, P.van, P.tot, V.van, V.tot]) // eslint-disable-line react-hooks/exhaustive-deps
  const perKlant = useMemo(() => groepeer(f, P, V, 'client_id'), [f, P.van, P.tot, V.van, V.tot]) // eslint-disable-line react-hooks/exhaustive-deps
  const evo = useMemo(() => evolutie(f, P, gran, lijnen), [f, P.van, P.tot, gran, lijnen]) // eslint-disable-line react-hooks/exhaustive-deps
  const rec = useMemo(() => f.filter((x) => x.recurring), [f])
  const recDienst = useMemo(() => groepeer(rec, P, V, 'dienst'), [rec, P.van, P.tot, V.van, V.tot]) // eslint-disable-line react-hooks/exhaustive-deps
  const recKlant = useMemo(() => groepeer(rec, P, V, 'client_id'), [rec, P.van, P.tot, V.van, V.tot]) // eslint-disable-line react-hooks/exhaustive-deps
  const recEvo = useMemo(() => evolutie(rec, P, 'maand', []), [rec, P.van, P.tot]) // eslint-disable-line react-hooks/exhaustive-deps
  const groeiPct = tv.gefactureerd ? Math.round(((t.gefactureerd - tv.gefactureerd) / Math.abs(tv.gefactureerd)) * 1000) / 10 : null
  const klantNaam = (id: string) => data?.klanten[id] ?? (id === '—' ? 'Zonder klant' : 'Onbekende klant')
  const dienstenVanKlant = useMemo(() => { const m = new Map<string, Set<string>>(); for (const x of f) { if (x.datum < P.van || x.datum > P.tot || !x.client_id) continue; const s = m.get(x.client_id) ?? new Set(); s.add(x.dienst); m.set(x.client_id, s) } return m }, [f, P.van, P.tot])

  // Specifieke maand/kwartaal/jaar-keuzes (laatste 3 jaar).
  const jaar = Number(vandaag.slice(0, 4))
  const specifiekeOpties = useMemo(() => {
    const o: [string, string][] = []
    for (let y = jaar; y >= jaar - 2; y--) {
      o.push([`jaar:${y}`, `Jaar ${y}`])
      for (let q = 4; q >= 1; q--) o.push([`kwartaal:${y}-Q${q}`, `Q${q} ${y}`])
      for (let m = 12; m >= 1; m--) o.push([`maand:${y}-${String(m).padStart(2, '0')}`, `${['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'][m - 1]} ${y}`])
    }
    return o
  }, [jaar])

  const werkmap = (): Werkmap => {
    const filters = [{ label: 'Periode', waarde: `${P.label || `${datumKort(P.van)} – ${datumKort(P.tot)}`} (${datumKort(P.van)} – ${datumKort(P.tot)})` }, ...(dienst ? [{ label: 'Dienst', waarde: dienstLabel(dienst) }] : []), ...(klant ? [{ label: 'Klant', waarde: klantNaam(klant) }] : []), ...(status ? [{ label: 'Status', waarde: STATUS_LABEL[status] }] : []), ...(type ? [{ label: 'Soort', waarde: type }] : [])]
    const e = (c: number) => ({ v: c / 100, stijl: 'euro' as const })
    return {
      bestandsnaam: 'omzetrapportage', titel: 'Omzetrapportage NextGenMedia', filters, bron: 'Facturenmodule (live)',
      bladen: [
        { naam: 'Samenvatting', titel: 'Kerncijfers (excl. btw)', blokken: [{ soort: 'kpis', items: [
          { label: 'Gefactureerde omzet', waarde: e(t.gefactureerd) }, { label: 'Ontvangen (op betaaldatum)', waarde: e(t.ontvangen) }, { label: 'Betaaldatum onbekend', waarde: e(t.ontvangenOnbekend) },
          { label: 'Openstaand', waarde: e(t.open) }, { label: 'Terugkerende omzet', waarde: e(t.recurring) }, { label: 'Vorige periode', waarde: e(tv.gefactureerd) }, { label: 'Aantal facturen', waarde: t.aantal },
        ] }] },
        { naam: 'Diensten', titel: 'Omzet per dienst', blokken: [{ soort: 'tabel', kolommen: [{ kop: 'Dienst' }, { kop: 'Gefactureerd', stijl: 'euro' }, { kop: 'Ontvangen', stijl: 'euro' }, { kop: 'Openstaand', stijl: 'euro' }, { kop: 'Facturen', stijl: 'aantal' }, { kop: 'Vorige periode', stijl: 'euro' }, { kop: 'Groei %', stijl: 'getal' }, { kop: 'Aandeel %', stijl: 'getal' }],
          rijen: perDienst.map((g) => [dienstLabel(g.sleutel), g.gefactureerd / 100, g.ontvangen / 100, g.open / 100, g.aantal, g.vorige / 100, g.groeiPct, g.aandeel]),
          totaal: ['Totaal', { f: 'SUM(B{R1}:B{R2})', stijl: 'totaal_euro' }, { f: 'SUM(C{R1}:C{R2})', stijl: 'totaal_euro' }, { f: 'SUM(D{R1}:D{R2})', stijl: 'totaal_euro' }, null, { f: 'SUM(F{R1}:F{R2})', stijl: 'totaal_euro' }, null, null] }] },
        { naam: 'Klanten', titel: 'Omzet per klant', blokken: [{ soort: 'tabel', kolommen: [{ kop: 'Klant' }, { kop: 'Gefactureerd', stijl: 'euro' }, { kop: 'Ontvangen', stijl: 'euro' }, { kop: 'Openstaand', stijl: 'euro' }, { kop: 'Facturen', stijl: 'aantal' }, { kop: 'Diensten' }, { kop: 'Aandeel %', stijl: 'getal' }],
          rijen: perKlant.map((g) => [klantNaam(g.sleutel), g.gefactureerd / 100, g.ontvangen / 100, g.open / 100, g.aantal, [...(dienstenVanKlant.get(g.sleutel) ?? [])].map(dienstLabel).join(', '), g.aandeel]) }] },
        { naam: 'Facturen', titel: 'Onderliggende facturen', blokken: [{ soort: 'tabel', kolommen: [{ kop: 'Factuurdatum', stijl: 'datum' }, { kop: 'Factuurnr.' }, { kop: 'Klant' }, { kop: 'Omschrijving' }, { kop: 'Diensten' }, { kop: 'Bedrag', stijl: 'euro' }, { kop: 'Ontvangen', stijl: 'euro' }, { kop: 'Openstaand', stijl: 'euro' }, { kop: 'Status' }],
          rijen: facturen(f, P).map((r) => [{ v: r.datum, stijl: 'datum' }, r.ref ?? '', klantNaam(r.client_id ?? '—'), r.omschrijving, r.diensten.map(dienstLabel).join(', '), r.bedrag / 100, r.ontvangen / 100, r.open / 100, STATUS_LABEL[r.status]]) }] },
      ],
    }
  }

  if (fout) return <div className="card-base text-sm text-red-700 flex items-center gap-2">{fout}<button type="button" onClick={laad} className="btn-secondary text-xs ml-auto">Opnieuw</button></div>
  if (!data) return <div className="card-base py-16 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>

  const dienstKolommen: Kol<Groep>[] = [
    { kop: 'Dienst', waarde: (g) => dienstLabel(g.sleutel), toon: (g) => <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: KLEUR[g.sleutel] }} />{dienstLabel(g.sleutel)}</span> },
    { kop: 'Gefactureerd', rechts: true, waarde: (g) => g.gefactureerd, toon: (g) => eur(g.gefactureerd) },
    { kop: 'Ontvangen', rechts: true, waarde: (g) => g.ontvangen, toon: (g) => eur(g.ontvangen) },
    { kop: 'Openstaand', rechts: true, waarde: (g) => g.open, toon: (g) => eur(g.open) },
    { kop: 'Facturen', rechts: true, waarde: (g) => g.aantal, toon: (g) => g.aantal },
    { kop: 'Vorige periode', rechts: true, waarde: (g) => g.vorige, toon: (g) => eur(g.vorige) },
    { kop: 'Groei', rechts: true, waarde: (g) => g.groeiPct ?? -1e9, toon: (g) => <Groei p={g.groeiPct} /> },
    { kop: 'Aandeel', rechts: true, waarde: (g) => g.aandeel, toon: (g) => `${g.aandeel.toLocaleString('nl-BE')}%` },
  ]
  const klantKolommen: Kol<Groep>[] = [
    { kop: 'Klant', waarde: (g) => klantNaam(g.sleutel), toon: (g) => klantNaam(g.sleutel) },
    { kop: 'Gefactureerd', rechts: true, waarde: (g) => g.gefactureerd, toon: (g) => eur(g.gefactureerd) },
    { kop: 'Ontvangen', rechts: true, waarde: (g) => g.ontvangen, toon: (g) => eur(g.ontvangen) },
    { kop: 'Openstaand', rechts: true, waarde: (g) => g.open, toon: (g) => eur(g.open) },
    { kop: 'Facturen', rechts: true, waarde: (g) => g.aantal, toon: (g) => g.aantal },
    { kop: 'Diensten', waarde: (g) => (dienstenVanKlant.get(g.sleutel)?.size ?? 0), toon: (g) => <span className="text-xs text-gray-600">{[...(dienstenVanKlant.get(g.sleutel) ?? [])].map(dienstLabel).join(', ') || '—'}</span> },
    { kop: 'Aandeel', rechts: true, waarde: (g) => g.aandeel, toon: (g) => `${g.aandeel.toLocaleString('nl-BE')}%` },
  ]
  const balkData = perDienst.filter((g) => g.gefactureerd > 0).map((g) => ({ naam: dienstLabel(g.sleutel), sleutel: g.sleutel, euro: g.gefactureerd / 100 }))
  const lijnData = evo.map((r) => ({ ...Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'number' ? v / 100 : v])), label: bucketLabel(String(r.bucket)) }))

  return (
    <div className="space-y-4">
      {/* Filters — één rij, combineerbaar */}
      <div className="card-base p-3 flex flex-wrap items-center gap-2">
        <select className={sel} value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Periode">
          {PRESETS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="specifiek">Specifieke maand / kwartaal / jaar…</option><option value="aangepast">Aangepaste periode…</option>
        </select>
        {preset === 'specifiek' && <select className={sel} value={specifiek} onChange={(e) => setSpecifiek(e.target.value)} aria-label="Specifieke periode"><option value="">— kies —</option>{specifiekeOpties.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>}
        {preset === 'aangepast' && <><input type="date" className={sel} value={van} onChange={(e) => setVan(e.target.value)} aria-label="Van" /><span className="text-gray-400">–</span><input type="date" className={sel} value={tot} onChange={(e) => setTot(e.target.value)} aria-label="Tot" /></>}
        <select className={sel} value={dienst} onChange={(e) => setDienst(e.target.value)} aria-label="Dienst"><option value="">Alle diensten</option>{ALLE_DIENSTEN.map((d) => <option key={d} value={d}>{dienstLabel(d)}</option>)}</select>
        <select className={`${sel} max-w-[200px]`} value={klant} onChange={(e) => setKlant(e.target.value)} aria-label="Klant"><option value="">Alle klanten</option>{Object.entries(data.klanten).filter(([id]) => data.feiten.some((x) => x.client_id === id)).sort((a, b) => a[1].localeCompare(b[1], 'nl')).map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select>
        <select className={sel} value={status} onChange={(e) => setStatus(e.target.value as FeitStatus | '')} aria-label="Factuurstatus"><option value="">Alle statussen</option>{(Object.keys(STATUS_LABEL) as FeitStatus[]).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
        <select className={sel} value={type} onChange={(e) => setType(e.target.value as typeof type)} aria-label="Eenmalig of terugkerend"><option value="">Eenmalig + terugkerend</option><option value="eenmalig">Eenmalig</option><option value="terugkerend">Terugkerend</option></select>
        {(dienst || klant || status || type) && <button type="button" onClick={() => { setDienst(''); setKlant(''); setStatus(''); setType('') }} className="btn-secondary text-xs"><X className="h-3.5 w-3.5" />Filters wissen</button>}
        <div className="flex-1" />
        <span className="text-xs text-gray-500">{datumKort(P.van)} – {datumKort(P.tot)} · vergeleken met {datumKort(V.van)} – {datumKort(V.tot)}</span>
        <ExportKnop werkmap={werkmap} label="Excel" className="btn-secondary text-xs" title="Exporteert exact de huidige selectie" />
      </div>

      {/* KPI's */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
        <Kpi titel="Gefactureerde omzet" waarde={eur(t.gefactureerd)} uitleg="Uitgereikte facturen op hun factuurdatum, excl. btw, ook onbetaald. Creditnota's verminderen. 'Te factureren' telt niet." sub={data.gepland ? `${data.gepland} item(s) nog te factureren — niet meegeteld` : undefined} />
        <Kpi titel="Ontvangen" waarde={eur(t.ontvangen)} uitleg="Werkelijk ontvangen betalingen excl. btw, op hun betaaldatum (gedeeltelijke betalingen inbegrepen)." sub={t.ontvangenOnbekend ? `+ ${eur(t.ontvangenOnbekend)} met onbekende betaaldatum` : undefined} />
        <Kpi titel="Openstaand" waarde={eur(t.open)} uitleg="Nog te ontvangen van de uitgereikte facturen in deze periode, excl. btw." />
        <Kpi titel="Terugkerende omzet" waarde={eur(t.recurring)} uitleg="Gefactureerde omzet uit terugkerende dienstverlening. De verwachte MRR is geen gerealiseerde omzet en telt nergens mee." sub={<>Verwachte MRR: {eur(data.verwachteMrr)} / maand</>} />
        <Kpi titel="Omzetgroei" waarde={pct(groeiPct)} uitleg={`Gefactureerde omzet t.o.v. ${datumKort(V.van)} – ${datumKort(V.tot)}.`} sub={<Groei p={groeiPct} verschil={t.gefactureerd - tv.gefactureerd} />} />
        <Kpi titel="Facturen" waarde={String(t.aantal)} uitleg="Aantal uitgereikte facturen (en gefactureerde maanden van terugkerende facturatie) in deze periode." />
      </div>

      {/* Omzet per dienst */}
      <section className="card-base space-y-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap"><h2 className="font-semibold">Omzet per dienst</h2><span className="text-xs text-gray-500">Klik op een dienst voor de details · som = {eur(perDienst.reduce((s, g) => s + g.gefactureerd, 0))}</span></div>
        {balkData.length > 0 && (
          <div style={{ height: Math.max(140, balkData.length * 34) }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={balkData} layout="vertical" margin={{ left: 8, right: 24, top: 0, bottom: 0 }} barCategoryGap={6}>
                <CartesianGrid horizontal={false} stroke="#ececea" />
                <XAxis type="number" tickFormatter={(v) => EUR0.format(v)} tick={{ fontSize: 11, fill: '#52514e' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="naam" width={170} tick={{ fontSize: 12, fill: '#0b0b0b' }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: '#f4f4f2' }} formatter={(v: number) => [EUR.format(v), 'Gefactureerd']} />
                <Bar dataKey="euro" fill="#111827" radius={[0, 4, 4, 0]} maxBarSize={22} onClick={(d: { sleutel?: string }) => d.sleutel && setDrill({ soort: 'dienst', sleutel: d.sleutel })} className="cursor-pointer" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
        <Tabel rijen={perDienst} kolommen={dienstKolommen} onKlik={(g) => setDrill({ soort: 'dienst', sleutel: g.sleutel })} />
      </section>

      {/* Omzetevolutie */}
      <section className="card-base space-y-3">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="font-semibold mr-auto">Omzetevolutie</h2>
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">{(['maand', 'kwartaal', 'jaar'] as Gran[]).map((g) => <button key={g} type="button" aria-pressed={gran === g} onClick={() => setGran(g)} className={`px-2.5 py-1 rounded-md text-xs font-medium capitalize ${gran === g ? 'bg-black text-white' : 'text-gray-600 hover:bg-white'}`}>per {g}</button>)}</div>
          <label className="text-xs text-gray-600 flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={toonTotaal} onChange={(e) => setToonTotaal(e.target.checked)} />Totaal tonen</label>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Diensten vergelijken">
          {ALLE_DIENSTEN.map((d) => { const aan = lijnen.includes(d); return <button key={d} type="button" aria-pressed={aan} onClick={() => setLijnen(aan ? lijnen.filter((x) => x !== d) : [...lijnen, d])} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${aan ? 'border-gray-800 bg-gray-50 font-medium' : 'border-gray-200 text-gray-600'}`}><span className="h-2 w-2 rounded-full" style={{ background: KLEUR[d] }} />{dienstLabel(d)}</button> })}
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={lijnData} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#ececea" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#52514e' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => EUR0.format(v)} tick={{ fontSize: 11, fill: '#52514e' }} axisLine={false} tickLine={false} width={80} />
              <Tooltip formatter={(v: number, naam: string) => [EUR.format(v), naam === 'totaal' ? 'Totaal' : dienstLabel(naam)]} labelFormatter={(l) => String(l)} />
              {(lijnen.length > 0 || toonTotaal) && <Legend formatter={(naam: string) => (naam === 'totaal' ? 'Totaal' : dienstLabel(naam))} wrapperStyle={{ fontSize: 12 }} />}
              {toonTotaal && <Line type="monotone" dataKey="totaal" stroke="#111827" strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />}
              {lijnen.map((d) => <Line key={d} type="monotone" dataKey={d} stroke={KLEUR[d]} strokeWidth={2} dot={{ r: 3 }} activeDot={{ r: 5 }} />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Omzet per klant */}
      <section className="card-base space-y-3">
        <div className="flex items-baseline justify-between gap-2 flex-wrap"><h2 className="font-semibold">Omzet per klant</h2><span className="text-xs text-gray-500">Klik op een klant voor de evolutie en de facturen</span></div>
        <Tabel rijen={perKlant} kolommen={klantKolommen} onKlik={(g) => g.sleutel !== '—' && setDrill({ soort: 'klant', sleutel: g.sleutel })} />
      </section>

      {/* Recurring revenue */}
      <section className="card-base space-y-3">
        <h2 className="font-semibold flex items-center gap-2"><Repeat className="h-4 w-4 text-gray-500" />Recurring revenue</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          <Kpi titel="Gefactureerd terugkerend" waarde={eur(t.recurring)} uitleg="Werkelijk gefactureerde terugkerende omzet in deze periode." />
          <Kpi titel="Ontvangen terugkerend" waarde={eur(t.recurringOntvangen)} uitleg="Ontvangen betalingen van terugkerende omzet, op betaaldatum." />
          <Kpi titel="Verwachte MRR (niet gerealiseerd)" waarde={`${eur(data.verwachteMrr)} / mnd`} uitleg="Som van de actieve maandelijkse facturatie deze maand. Een verwachting — telt nooit mee bij de gefactureerde omzet." />
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={recEvo.map((r) => ({ label: bucketLabel(String(r.bucket)), euro: (r.totaal as number) / 100 }))} margin={{ left: 8, right: 16, top: 8, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="#ececea" />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#52514e' }} axisLine={false} tickLine={false} />
              <YAxis tickFormatter={(v) => EUR0.format(v)} tick={{ fontSize: 11, fill: '#52514e' }} axisLine={false} tickLine={false} width={80} />
              <Tooltip cursor={{ fill: '#f4f4f2' }} formatter={(v: number) => [EUR.format(v), 'Terugkerend gefactureerd']} />
              <Bar dataKey="euro" fill="#2a78d6" radius={[4, 4, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="grid lg:grid-cols-2 gap-4">
          <div><h3 className="text-sm font-medium mb-1">Per dienst</h3><Tabel rijen={recDienst} kolommen={dienstKolommen.filter((k) => ['Dienst', 'Gefactureerd', 'Ontvangen', 'Aandeel'].includes(k.kop))} onKlik={(g) => setDrill({ soort: 'dienst', sleutel: g.sleutel })} /></div>
          <div><h3 className="text-sm font-medium mb-1">Per klant</h3><Tabel rijen={recKlant} kolommen={klantKolommen.filter((k) => ['Klant', 'Gefactureerd', 'Ontvangen', 'Aandeel'].includes(k.kop))} onKlik={(g) => g.sleutel !== '—' && setDrill({ soort: 'klant', sleutel: g.sleutel })} /></div>
        </div>
      </section>

      {drill && <DrillPaneel drill={drill} feiten={f} P={P} klantNaam={klantNaam} onSluit={() => setDrill(null)} onGewijzigd={laad} />}
    </div>
  )
}

/** Doorklik: één dienst of één klant — totalen, per maand, klanten/diensten en de facturen. */
function DrillPaneel({ drill, feiten, P, klantNaam, onSluit, onGewijzigd }: { drill: NonNullable<Drill>; feiten: Feit[]; P: Periode; klantNaam: (id: string) => string; onSluit: () => void; onGewijzigd: () => void }) {
  const eigen = feiten.filter((x) => (drill.soort === 'dienst' ? x.dienst === drill.sleutel : x.client_id === drill.sleutel))
  const t = totalen(eigen, P)
  const perMaand = evolutie(eigen, P, 'maand', [])
  const max = Math.max(1, ...perMaand.map((r) => Math.abs(r.totaal as number)))
  const anderen = groepeer(eigen, P, vorigePeriode(P), drill.soort === 'dienst' ? 'client_id' : 'dienst')
  const lijst = facturen(eigen, P)
  const titel = drill.soort === 'dienst' ? dienstLabel(drill.sleutel) : klantNaam(drill.sleutel)
  const teCategoriseren = drill.soort === 'dienst' && drill.sleutel === NIET_GECATEGORISEERD ? eigen.filter((x) => x.soort === 'factuur' && x.datum >= P.van && x.datum <= P.tot) : []
  const koppel = async (sleutel: string, dienst: string) => {
    const r = await fetch('/api/admin/revenue/analyse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'dienst', sleutel: sleutel.replace(/^cred:/, 'inv:'), dienst }) })
    const j = await r.json().catch(() => ({}))
    if (!r.ok) { toast.error(j.error || 'Koppelen mislukt'); return }
    toast.success(`Gekoppeld aan ${dienstLabel(dienst)}. De rapportage rekent opnieuw.`); onGewijzigd()
  }
  const link = (r: { invoice_id: string | null; datum: string }) => (r.invoice_id ? `/admin/invoices?factuur=${r.invoice_id}` : `/admin/invoices?datum=${r.datum}`)
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label={titel}>
      <div className="absolute inset-0 bg-black/25" onClick={onSluit} />
      <aside className="absolute inset-y-0 right-0 w-full sm:w-[640px] bg-white shadow-2xl flex flex-col">
        <div className="px-5 py-4 border-b border-gray-100 flex items-start gap-3">
          <div className="flex-1 min-w-0"><h3 className="font-semibold truncate">{titel}</h3><div className="text-xs text-gray-500">{datumKort(P.van)} – {datumKort(P.tot)}</div></div>
          <button type="button" onClick={onSluit} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
            {[['Gefactureerd', eur(t.gefactureerd)], ['Ontvangen', eur(t.ontvangen)], ['Openstaand', eur(t.open)], ['Facturen', String(t.aantal)]].map(([k, v]) => <div key={k} className="rounded-lg border border-gray-200 p-2"><div className="text-[11px] text-gray-500">{k}</div><div className="font-semibold tabular-nums">{v}</div></div>)}
          </div>
          <section>
            <h4 className="text-sm font-medium mb-1.5">Per maand</h4>
            <ul className="space-y-1">{perMaand.map((r) => (
              <li key={String(r.bucket)} className="flex items-center gap-2 text-xs">
                <span className="w-14 text-gray-500">{bucketLabel(String(r.bucket))}</span>
                <span className="flex-1 h-2 bg-gray-100 rounded"><span className={`block h-2 rounded ${(r.totaal as number) < 0 ? 'bg-red-400' : 'bg-gray-800'}`} style={{ width: `${(Math.abs(r.totaal as number) / max) * 100}%` }} /></span>
                <span className="w-24 text-right tabular-nums">{eur(r.totaal as number)}</span>
              </li>
            ))}</ul>
          </section>
          <section>
            <h4 className="text-sm font-medium mb-1.5">{drill.soort === 'dienst' ? 'Klanten' : 'Diensten'}</h4>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 text-sm">{anderen.map((g) => (
              <li key={g.sleutel} className="px-3 py-1.5 flex justify-between gap-2"><span className="truncate">{drill.soort === 'dienst' ? klantNaam(g.sleutel) : dienstLabel(g.sleutel)}</span><span className="tabular-nums">{eur(g.gefactureerd)}{g.open ? <span className="text-gray-500 text-xs"> · open {eur(g.open)}</span> : null}</span></li>
            ))}{!anderen.length && <li className="px-3 py-2 text-gray-400">—</li>}</ul>
          </section>
          {teCategoriseren.length > 0 && (
            <section className="space-y-1.5">
              <h4 className="text-sm font-medium">Dienst koppelen</h4>
              <p className="text-[11px] text-gray-500">Kies per regel de dienst; historische cijfers rekenen meteen opnieuw.</p>
              {teCategoriseren.map((x) => (
                <div key={x.sleutel} className="flex items-center gap-2 text-xs flex-wrap">
                  <span className="flex-1 min-w-[180px] truncate">{datumKort(x.datum)} · {klantNaam(x.client_id ?? '—')} · {x.omschrijving}</span>
                  <span className="tabular-nums w-20 text-right">{eur(x.bedrag)}</span>
                  <select className="rounded border border-gray-200 px-1.5 py-1" defaultValue="" onChange={(e) => e.target.value && koppel(x.sleutel, e.target.value)} aria-label={`Dienst voor ${x.omschrijving}`}><option value="">— dienst —</option>{Object.entries(DIENST_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                </div>
              ))}
            </section>
          )}
          <section>
            <h4 className="text-sm font-medium mb-1.5">Facturen ({lijst.length})</h4>
            <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100">{lijst.map((r) => (
              <li key={`${r.factuur}:${r.bedrag}:${r.datum}`} className="px-3 py-2 flex items-start gap-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="truncate">{r.omschrijving}{r.recurring && <Repeat className="inline h-3 w-3 ml-1 text-gray-400" aria-label="terugkerend" />}</div>
                  <div className="text-[11px] text-gray-500">{datumKort(r.datum)}{r.ref ? ` · ${r.ref}` : ''} · {klantNaam(r.client_id ?? '—')} · {STATUS_LABEL[r.status]}</div>
                </div>
                <div className="text-right text-xs tabular-nums"><div className="font-medium text-sm">{eur(r.bedrag)}</div>{r.open > 0 && <div className="text-gray-500">open {eur(r.open)}</div>}</div>
                <a href={link(r)} className="text-gray-400 hover:text-black" title="Factuur openen" aria-label="Factuur openen"><ExternalLink className="h-4 w-4" /></a>
              </li>
            ))}{!lijst.length && <li className="px-3 py-2 text-sm text-gray-400">Geen facturen.</li>}</ul>
          </section>
        </div>
      </aside>
    </div>
  )
}
