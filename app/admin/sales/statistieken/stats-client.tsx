'use client'

import { KaartTabel } from '@/components/ui/kaart-tabel'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { ArrowDown, ArrowUp, Loader2, Trophy, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toonPercentage, type AccountRij, type Cijfers, type Rij, type Statistieken } from '@/lib/sales/statistieken'
import { toonUren } from '@/lib/sales/beltijd'
import { BeltijdKaart } from '@/components/admin/sales-beltijd'
import { formatDuur } from '@/lib/sales/activiteiten-model'
import { DIENSTEN, LEADBRONNEN, leadbronLabel } from '@/lib/sales/leadbron'
import { ExportKnop } from '@/components/admin/export-knop'
import { statistiekenWerkmap } from '@/lib/excel/rapporten/statistieken'

const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const getal = new Intl.NumberFormat('nl-BE')

type Antwoord = {
  stats: Statistieken
  medewerkers: { id: string; naam: string }[]
  metActiviteiten: boolean
  metBeltijd: boolean
  accounts: AccountRij[]
  isAdmin: boolean
  meId: string
}

type Bereik = { van: string; tot: string }

/** JJJJ-MM-DD in lokale tijd (niet via toISOString: dat is UTC). */
const dagTekst = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

function bereikVoor(preset: string): Bereik {
  const nu = new Date()
  if (preset === 'vandaag') return { van: dagTekst(nu), tot: dagTekst(nu) }
  if (preset === 'week') {
    const ma = new Date(nu); ma.setDate(nu.getDate() - ((nu.getDay() + 6) % 7))
    const zo = new Date(ma); zo.setDate(ma.getDate() + 6)
    return { van: dagTekst(ma), tot: dagTekst(zo) }
  }
  return { van: dagTekst(new Date(nu.getFullYear(), nu.getMonth(), 1)), tot: dagTekst(new Date(nu.getFullYear(), nu.getMonth() + 1, 0)) }
}

const PRESETS = [
  { key: 'vandaag', label: 'Vandaag' },
  { key: 'week', label: 'Deze week' },
  { key: 'maand', label: 'Deze maand' },
  { key: 'eigen', label: 'Eigen periode' },
]

export function StatsClient() {
  const [preset, setPreset] = useState('maand')
  const [bereik, setBereik] = useState<Bereik>(() => bereikVoor('maand'))
  const [medewerker, setMedewerker] = useState('')
  const [richting, setRichting] = useState('')
  const [dienst, setDienst] = useState('')
  const [leadbron, setLeadbron] = useState('')
  const [trend, setTrend] = useState('')
  const [data, setData] = useState<Antwoord | null>(null)
  const [bezig, setBezig] = useState(true)
  const [fout, setFout] = useState<string | null>(null)

  const haal = useCallback(async () => {
    setBezig(true); setFout(null)
    const q = new URLSearchParams({ van: bereik.van, tot: bereik.tot })
    if (medewerker) q.set('medewerker', medewerker)
    if (richting) q.set('richting', richting)
    if (dienst) q.set('dienst', dienst)
    if (leadbron) q.set('leadbron', leadbron)
    if (trend) q.set('trend', trend)
    try {
      const r = await fetch(`/api/admin/sales/statistieken?${q}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Kon de cijfers niet laden.')
      setData(d)
    } catch (e) {
      setFout((e as Error).message)
    } finally { setBezig(false) }
  }, [bereik, medewerker, richting, dienst, leadbron, trend])

  useEffect(() => { haal() }, [haal])

  const kies = (key: string) => {
    setPreset(key)
    if (key !== 'eigen') setBereik(bereikVoor(key))
  }

  const t = data?.stats.team
  const gekozenNaam = medewerker ? (data?.medewerkers.find((m) => m.id === medewerker)?.naam ?? null) : null
  const leadFilters = !!(richting || dienst || leadbron)
  const exportFilters = [
    richting ? { label: 'Richting', waarde: richting === 'inbound' ? 'Inbound' : 'Outbound' } : null,
    dienst ? { label: 'Dienst', waarde: dienst } : null,
    leadbron ? { label: 'Leadbron', waarde: leadbronLabel(leadbron) } : null,
  ].filter((x): x is { label: string; waarde: string } => !!x)

  return (
    <div className="space-y-6">
      {/* ── Filters ── */}
      <div className="card-base flex flex-wrap items-end gap-3">
        <div className="flex gap-1 flex-wrap">
          {PRESETS.map((o) => (
            <button key={o.key} onClick={() => kies(o.key)}
              className={cn('text-xs font-semibold px-3 py-2 rounded-xl border transition-colors',
                preset === o.key ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50')}>
              {o.label}
            </button>
          ))}
        </div>
        {preset === 'eigen' && (
          <div className="flex items-end gap-2">
            <label className="text-xs text-gray-500">Van
              <input type="date" value={bereik.van} onChange={(e) => setBereik((b) => ({ ...b, van: e.target.value }))}
                className="block text-sm border border-gray-200 rounded-xl px-3 py-1.5 mt-1" />
            </label>
            <label className="text-xs text-gray-500">Tot en met
              <input type="date" value={bereik.tot} onChange={(e) => setBereik((b) => ({ ...b, tot: e.target.value }))}
                className="block text-sm border border-gray-200 rounded-xl px-3 py-1.5 mt-1" />
            </label>
          </div>
        )}
        {data?.isAdmin && (
          <Keuze label="Medewerker" waarde={medewerker} onChange={setMedewerker}
            opties={[{ v: '', l: 'Iedereen' }, ...data.medewerkers.map((m) => ({ v: m.id, l: m.naam }))]} />
        )}
        <Keuze label="Inbound / outbound" waarde={richting} onChange={setRichting}
          opties={[{ v: '', l: 'Alles' }, { v: 'inbound', l: 'Inbound' }, { v: 'outbound', l: 'Outbound' }]} />
        <Keuze label="Dienst" waarde={dienst} onChange={setDienst}
          opties={[{ v: '', l: 'Alle diensten' }, ...DIENSTEN.map((d) => ({ v: d, l: d }))]} />
        <Keuze label="Leadbron" waarde={leadbron} onChange={setLeadbron}
          opties={[{ v: '', l: 'Alle bronnen' }, ...LEADBRONNEN.map((b) => ({ v: b.key, l: b.label }))]} />
        <Keuze label="Trend per" waarde={trend} onChange={setTrend}
          opties={[{ v: '', l: 'Automatisch' }, { v: 'dag', l: 'Dag' }, { v: 'week', l: 'Week' }, { v: 'maand', l: 'Maand' }]} />
        {bezig && <Loader2 className="h-4 w-4 animate-spin text-gray-400 mb-2" />}
        {data && (
          <div className="ml-auto">
            <ExportKnop werkmap={() => statistiekenWerkmap({
              stats: data.stats, bereik, isAdmin: data.isAdmin, filters: exportFilters,
              medewerkerNaam: medewerker ? (data.medewerkers.find((m) => m.id === medewerker)?.naam ?? null) : null,
            })} />
          </div>
        )}
      </div>

      {/* ── Accounts: één kaart per account; klik = alle cijfers van dat account ── */}
      {data && data.accounts.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h2 className="font-semibold">{data.isAdmin ? 'Accounts' : 'Mijn cijfers'}</h2>
            {data.isAdmin && medewerker && (
              <button onClick={() => setMedewerker('')} className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-gray-200 hover:bg-gray-50 flex items-center gap-1">
                <X className="h-3 w-3" />Toon iedereen
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {data.accounts.map((a) => (
              <AccountKaart key={a.sleutel} rij={a} actief={medewerker === a.sleutel} klikbaar={data.isAdmin}
                onKlik={() => setMedewerker(medewerker === a.sleutel ? '' : a.sleutel)} />
            ))}
          </div>
        </div>
      )}

      {/* ── Beltijd loggen (eigen account, of het gekozen account voor een admin) ── */}
      {data && (
        <BeltijdKaart key={medewerker || 'ik'} medewerkerId={data.isAdmin && medewerker ? medewerker : undefined}
          accountNaam={gekozenNaam} onGewijzigd={() => haal()} />
      )}

      {data?.isAdmin && gekozenNaam && (
        <p className="text-sm font-semibold -mb-2">Alle statistieken van {gekozenNaam}</p>
      )}

      {fout && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{fout}</p>}
      {data && !data.metActiviteiten && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2">
          De activiteitenregistratie is nog niet actief (databankmigratie). Tot dan tellen enkel de oude
          belregistraties, zonder duur of uitkomst.
        </p>
      )}

      {t && data && (
        <>
          {/* ── Teamtotalen ── */}
          <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
            <Kaart label="Telefoongesprekken" waarde={getal.format(t.telefoongesprekken)} onder={`${getal.format(t.uniekeLeads)} unieke leads`} />
            <Kaart label="Gelogde beltijd" waarde={data.metBeltijd ? toonUren(t.gelogdeBeltijdSeconden) : '—'}
              onder={!data.metBeltijd ? 'na de databankmigratie' : leadFilters ? 'belsessies · lead-filters gelden hier niet' : 'belsessies (start/stop of handmatig)'} />
            <Kaart label="Totale gespreksduur" waarde={formatDuur(t.beltijdSeconden)} onder={`som van ${getal.format(t.gesprekkenMetDuur)} gesprekken met duur`} />
            <Kaart label="Gem. gespreksduur" waarde={formatDuur(t.gemiddeldeDuurSeconden)} onder="enkel gesprekken met duur" />
            <Kaart label="E-mails" waarde={getal.format(t.emails)} />
            <Kaart label="Opvolgingen" waarde={getal.format(t.opvolgingen)} />
            <Kaart label="Afspraken" waarde={getal.format(t.afspraken)} />
            <Kaart label="Voorstellen" waarde={getal.format(t.voorstellen)} />
            <Kaart label="Gewonnen" waarde={getal.format(t.gewonnen)} onder={`${getal.format(t.verloren)} verloren`} />
            <Kaart label="Closing rate" waarde={toonPercentage(t.closingRate)} onder="gewonnen ÷ (gewonnen + verloren)" accent />
            <Kaart label="Appointment setting" waarde={toonPercentage(t.appointmentRate)} onder="leads met afspraak ÷ leads met contact" accent />
            <Kaart label="Contact rate" waarde={toonPercentage(t.contactRate)} onder="leads met contact ÷ behandelde leads" />
            <Kaart label="Waarde gewonnen" waarde={euro.format(t.waardeGewonnenCent / 100)} />
          </div>

          {/* ── Vergelijking ── */}
          {data.isAdmin && data.stats.perMedewerker.length > 1 && data.stats.vergelijking.length > 0 && (
            <div className="card-base">
              <h2 className="font-semibold mb-3">Vergelijking</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                {data.stats.vergelijking.map((v) => (
                  <div key={v.titel} className="rounded-xl border border-gray-200 px-3 py-2">
                    <div className="text-[11px] text-gray-400 uppercase tracking-wide flex items-center gap-1"><Trophy className="h-3 w-3 text-amber-500" />{v.titel}</div>
                    <div className="font-semibold mt-0.5 truncate">{v.naam}</div>
                    <div className="text-sm text-gray-600 tabular-nums">{v.waarde}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Per medewerker ── */}
          {data.isAdmin && (
            <Tabel titel="Per medewerker" eersteKop="Medewerker" rijen={data.stats.perMedewerker} team={t}
              uitleg="Unieke leads zijn per medewerker geteld; de teamrij telt elke lead één keer." />
          )}

          {/* ── Trend ── */}
          {data.stats.trend.length > 0 && (
            <div className="card-base">
              <h2 className="font-semibold mb-1">Trend per {data.stats.trendPer}</h2>
              <div className="text-xs text-gray-400 mb-3">Gesprekken en e-mails tegenover geplande afspraken en gewonnen deals</div>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={data.stats.trend} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="sleutel" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="l" allowDecimals={false} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="r" orientation="right" allowDecimals={false} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <Tooltip labelStyle={{ fontWeight: 600 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="telefoongesprekken" name="Telefoongesprekken" fill="#d1d5db" radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="l" dataKey="emails" name="E-mails" fill="#fde68a" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="r" type="monotone" dataKey="afspraken" name="Afspraken" stroke="#3b82f6" strokeWidth={2} dot={{ r: 3 }} />
                  <Line yAxisId="r" type="monotone" dataKey="gewonnen" name="Gewonnen" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Per leadbron ── */}
          <Tabel titel="Resultaten per leadbron" eersteKop="Leadbron" rijen={data.stats.perLeadbron} team={t}
            uitleg="Waar leveren de leads het meest op?" />

          {t.telefoongesprekken === 0 && t.emails === 0 && t.afspraken === 0 && t.gewonnen === 0 && t.verloren === 0 && (
            <p className="text-sm text-gray-500 border border-gray-200 rounded-2xl px-4 py-12 text-center">
              Geen activiteiten in deze periode.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function AccountKaart({ rij, actief, klikbaar, onKlik }: { rij: AccountRij; actief: boolean; klikbaar: boolean; onKlik: () => void }) {
  const inhoud = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="font-semibold truncate">{rij.label}</span>
        {rij.beltijdLoopt && <span className="text-[10px] font-semibold text-green-700 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5 shrink-0">belt nu</span>}
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1.5 text-left">
        <Mini label="Gesprekken" waarde={getal.format(rij.telefoongesprekken)} />
        <Mini label="Beltijd" waarde={toonUren(rij.gelogdeBeltijdSeconden)} />
        <Mini label="Afspraken" waarde={getal.format(rij.afspraken)} />
        <Mini label="Gewonnen" waarde={getal.format(rij.gewonnen)} />
        <Mini label="Closing" waarde={toonPercentage(rij.closingRate)} />
        <Mini label="Afspr.-rate" waarde={toonPercentage(rij.appointmentRate)} />
      </dl>
    </>
  )
  const stijl = cn('card-base !p-3 w-full text-left transition-colors', actief && 'ring-2 ring-black', klikbaar && 'hover:border-gray-300 cursor-pointer')
  return klikbaar
    ? <button type="button" onClick={onKlik} className={stijl} aria-pressed={actief} title={actief ? 'Toon iedereen' : `Alle statistieken van ${rij.label}`}>{inhoud}</button>
    : <div className={stijl}>{inhoud}</div>
}

function Mini({ label, waarde }: { label: string; waarde: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] uppercase tracking-wide text-gray-400 truncate">{label}</dt>
      <dd className="text-sm font-bold tabular-nums truncate">{waarde}</dd>
    </div>
  )
}

function Keuze({ label, waarde, onChange, opties }: {
  label: string; waarde: string; onChange: (v: string) => void; opties: { v: string; l: string }[]
}) {
  return (
    <label className="text-xs text-gray-500">
      {label}
      <select value={waarde} onChange={(e) => onChange(e.target.value)}
        className="block text-sm border border-gray-200 rounded-xl px-3 py-1.5 mt-1 bg-white min-w-[9rem]">
        {opties.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </select>
    </label>
  )
}

function Kaart({ label, waarde, onder, accent }: { label: string; waarde: string; onder?: string; accent?: boolean }) {
  return (
    <div className={cn('card-base', accent && 'ring-2 ring-[#fff848]')}>
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{waarde}</div>
      {onder && <div className="text-[11px] text-gray-400 mt-0.5">{onder}</div>}
    </div>
  )
}

type Kolom = { kop: string; titel?: string; waarde: (c: Cijfers) => number | null; toon: (c: Cijfers) => string }

const KOLOMMEN: Kolom[] = [
  { kop: 'Gesprekken', waarde: (c) => c.telefoongesprekken, toon: (c) => getal.format(c.telefoongesprekken) },
  { kop: 'Gelogd', titel: 'Gelogde beltijd (belsessies)', waarde: (c) => c.gelogdeBeltijdSeconden, toon: (c) => toonUren(c.gelogdeBeltijdSeconden) },
  { kop: 'Gespreksduur', titel: 'Totale gespreksduur: som van de duur per gesprek', waarde: (c) => c.beltijdSeconden, toon: (c) => formatDuur(c.beltijdSeconden) },
  { kop: 'Gem. duur', titel: 'Enkel gesprekken met een geregistreerde duur', waarde: (c) => c.gemiddeldeDuurSeconden, toon: (c) => formatDuur(c.gemiddeldeDuurSeconden) },
  { kop: 'E-mails', waarde: (c) => c.emails, toon: (c) => getal.format(c.emails) },
  { kop: 'Leads', titel: 'Unieke behandelde leads', waarde: (c) => c.uniekeLeads, toon: (c) => getal.format(c.uniekeLeads) },
  { kop: 'Opvolg.', titel: 'Opvolgingen', waarde: (c) => c.opvolgingen, toon: (c) => getal.format(c.opvolgingen) },
  { kop: 'Afspraken', waarde: (c) => c.afspraken, toon: (c) => getal.format(c.afspraken) },
  { kop: 'Voorst.', titel: 'Voorstellen', waarde: (c) => c.voorstellen, toon: (c) => getal.format(c.voorstellen) },
  { kop: 'Gew.', titel: 'Gewonnen', waarde: (c) => c.gewonnen, toon: (c) => getal.format(c.gewonnen) },
  { kop: 'Verl.', titel: 'Verloren', waarde: (c) => c.verloren, toon: (c) => getal.format(c.verloren) },
  { kop: 'Closing', titel: 'Gewonnen ÷ (gewonnen + verloren)', waarde: (c) => c.closingRate, toon: (c) => toonPercentage(c.closingRate) },
  { kop: 'Afspr.-rate', titel: 'Leads met afspraak ÷ leads met geslaagd contact', waarde: (c) => c.appointmentRate, toon: (c) => toonPercentage(c.appointmentRate) },
  { kop: 'Contact', titel: 'Leads met geslaagd contact ÷ behandelde leads', waarde: (c) => c.contactRate, toon: (c) => toonPercentage(c.contactRate) },
  { kop: 'Waarde', titel: 'Waarde gewonnen deals', waarde: (c) => c.waardeGewonnenCent, toon: (c) => euro.format(c.waardeGewonnenCent / 100) },
]

function Tabel({ titel, uitleg, rijen, eersteKop, team }: {
  titel: string; uitleg: string; rijen: Rij[]; eersteKop: string; team: Cijfers
}) {
  const [sorteerOp, setSorteerOp] = useState<number | null>(null)
  const [omgekeerd, setOmgekeerd] = useState(false)
  const gesorteerd = useMemo(() => {
    if (sorteerOp === null) return rijen
    const k = KOLOMMEN[sorteerOp]
    return [...rijen].sort((a, b) => {
      const va = k.waarde(a), vb = k.waarde(b)
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      return omgekeerd ? va - vb : vb - va
    })
  }, [rijen, sorteerOp, omgekeerd])

  if (rijen.length === 0) return null
  const klik = (i: number) => {
    if (sorteerOp === i) setOmgekeerd((o) => !o)
    else { setSorteerOp(i); setOmgekeerd(false) }
  }

  return (
    <div className="card-base">
      <h2 className="font-semibold mb-1">{titel}</h2>
      <div className="text-xs text-gray-400 mb-3">{uitleg}</div>
      <div className="overflow-x-auto">
        <KaartTabel><table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="text-left font-semibold py-2 pr-3">{eersteKop}</th>
              {KOLOMMEN.map((k, i) => (
                <th key={k.kop} className="text-right font-semibold py-2 px-2 whitespace-nowrap">
                  <button onClick={() => klik(i)} title={k.titel} className="inline-flex items-center gap-1 hover:text-gray-700">
                    {k.kop}{sorteerOp === i && (omgekeerd ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {gesorteerd.map((r) => (
              <tr key={r.sleutel} className="border-b border-gray-50 hover:bg-gray-50/60">
                <td className="py-2 pr-3 font-medium whitespace-nowrap">{r.label}</td>
                {KOLOMMEN.map((k) => <td key={k.kop} className="text-right py-2 px-2 tabular-nums whitespace-nowrap">{k.toon(r)}</td>)}
              </tr>
            ))}
            <tr className="border-t border-gray-200 font-semibold">
              <td className="py-2 pr-3">Team</td>
              {KOLOMMEN.map((k) => <td key={k.kop} className="text-right py-2 px-2 tabular-nums whitespace-nowrap">{k.toon(team)}</td>)}
            </tr>
          </tbody>
        </table></KaartTabel>
      </div>
    </div>
  )
}
