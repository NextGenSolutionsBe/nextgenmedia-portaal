'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bar, BarChart, CartesianGrid, Legend, Line, ComposedChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { cn } from '@/lib/utils'
import {
  percentage, toonPercentage, type Groep, type Statistieken,
} from '@/lib/sales/statistieken'
import { ArrowDown, ArrowUp, Loader2, TrendingUp } from 'lucide-react'

const euro = new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })
const getal = new Intl.NumberFormat('nl-BE')

type Antwoord = {
  stats: Statistieken
  setters: { id: string; naam: string }[]
  sectoren: string[]
  isAdmin: boolean
  meId?: string
}

/** Een datum als JJJJ-MM-DD, in lokale tijd. Niet via toISOString: dat rekent
 *  in UTC en levert hier de verkeerde dag op. */
const dagTekst = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

type Bereik = { van: string; tot: string }

function presets(): { key: string; label: string; bereik: () => Bereik }[] {
  const nu = new Date()
  const j = nu.getFullYear()
  const m = nu.getMonth()
  const maand = (jaar: number, maandNr: number): Bereik => ({
    van: dagTekst(new Date(jaar, maandNr, 1)),
    tot: dagTekst(new Date(jaar, maandNr + 1, 0)),
  })
  return [
    { key: 'deze-maand', label: 'Deze maand', bereik: () => maand(j, m) },
    { key: 'vorige-maand', label: 'Vorige maand', bereik: () => maand(j, m - 1) },
    {
      key: 'kwartaal',
      label: 'Dit kwartaal',
      bereik: () => {
        const start = Math.floor(m / 3) * 3
        return { van: dagTekst(new Date(j, start, 1)), tot: dagTekst(new Date(j, start + 3, 0)) }
      },
    },
    {
      key: 'jaar',
      label: 'Dit jaar',
      bereik: () => ({ van: dagTekst(new Date(j, 0, 1)), tot: dagTekst(new Date(j, 11, 31)) }),
    },
  ]
}

export function StatsClient() {
  const opties = useMemo(presets, [])
  const [preset, setPreset] = useState('deze-maand')
  const [bereik, setBereik] = useState<Bereik>(() => opties[0].bereik())
  const [setter, setSetter] = useState('')
  const [sector, setSector] = useState('')
  const [data, setData] = useState<Antwoord | null>(null)
  const [bezig, setBezig] = useState(true)
  const [fout, setFout] = useState<string | null>(null)

  const haal = useCallback(async () => {
    setBezig(true); setFout(null)
    const q = new URLSearchParams({ van: bereik.van, tot: bereik.tot })
    if (setter) q.set('setter', setter)
    if (sector) q.set('sector', sector)
    try {
      const r = await fetch(`/api/admin/sales/statistieken?${q}`)
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'Kon de cijfers niet laden.')
      setData(d)
    } catch (e) {
      setFout((e as Error).message)
    } finally {
      setBezig(false)
    }
  }, [bereik, setter, sector])

  useEffect(() => { haal() }, [haal])

  const kiesPreset = (key: string) => {
    setPreset(key)
    const p = opties.find((o) => o.key === key)
    if (p) setBereik(p.bereik())
  }

  const t = data?.stats.totaal

  return (
    <div className="space-y-6">
      {/* ── Filters ── */}
      <div className="card-base flex flex-wrap items-end gap-3">
        <div className="flex gap-1">
          {opties.map((o) => (
            <button
              key={o.key}
              onClick={() => kiesPreset(o.key)}
              className={cn(
                'text-xs font-semibold px-3 py-2 rounded-xl border transition-colors',
                preset === o.key ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50',
              )}
            >
              {o.label}
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2">
          <label className="text-xs text-gray-500">
            Van
            <input
              type="date" value={bereik.van}
              onChange={(e) => { setPreset(''); setBereik((b) => ({ ...b, van: e.target.value })) }}
              className="block text-sm border border-gray-200 rounded-xl px-3 py-1.5 mt-1"
            />
          </label>
          <label className="text-xs text-gray-500">
            Tot en met
            <input
              type="date" value={bereik.tot}
              onChange={(e) => { setPreset(''); setBereik((b) => ({ ...b, tot: e.target.value })) }}
              className="block text-sm border border-gray-200 rounded-xl px-3 py-1.5 mt-1"
            />
          </label>
        </div>

        {/* Een setter ziet alleen zichzelf; dan is de keuzelijst zinloos. */}
        {data?.isAdmin && data.setters.length > 1 && (
          <label className="text-xs text-gray-500">
            Setter
            <select
              value={setter} onChange={(e) => setSetter(e.target.value)}
              className="block text-sm border border-gray-200 rounded-xl px-3 py-1.5 mt-1 bg-white min-w-[10rem]"
            >
              <option value="">Iedereen</option>
              {data.setters.map((s) => <option key={s.id} value={s.id}>{s.naam}</option>)}
            </select>
          </label>
        )}

        {(data?.sectoren.length ?? 0) > 1 && (
          <label className="text-xs text-gray-500">
            Sector
            <select
              value={sector} onChange={(e) => setSector(e.target.value)}
              className="block text-sm border border-gray-200 rounded-xl px-3 py-1.5 mt-1 bg-white min-w-[10rem]"
            >
              <option value="">Alle sectoren</option>
              {data!.sectoren.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        )}

        {bezig && <Loader2 className="h-4 w-4 animate-spin text-gray-400 mb-2" />}
      </div>

      {fout && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-3">{fout}</p>
      )}

      {t && (
        <>
          {/* ── Kerncijfers ── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-6 gap-3">
            <Kaart label="Gesprekken" waarde={getal.format(t.gesprekken)} onder={`${getal.format(t.leadsGebeld)} unieke leads`} />
            <Kaart label="Afspraken" waarde={getal.format(t.afspraken)} onder={`${getal.format(t.geannuleerd)} geannuleerd`} />
            <Kaart
              label="Boekingsratio"
              waarde={toonPercentage(percentage(t.afspraken, t.gesprekken))}
              onder="afspraak per gesprek"
            />
            <Kaart
              label="Opkomst"
              waarde={toonPercentage(percentage(t.doorgegaan, t.afspraken))}
              onder={`${getal.format(t.noShows)} no-shows`}
            />
            <Kaart
              label="Sluitingsratio"
              waarde={toonPercentage(percentage(t.gewonnen, t.gewonnen + t.verloren))}
              onder={`${getal.format(t.gewonnen)} gewonnen · ${getal.format(t.open)} open`}
              accent
            />
            <Kaart label="Contractwaarde" waarde={euro.format(t.dealWaardeCent / 100)} onder="gewonnen deals" />
          </div>

          {/* ── Trechter ── */}
          <div className="card-base">
            <h2 className="font-semibold mb-1">Waar loopt het weg?</h2>
            <div className="text-xs text-gray-400 mb-4">
              Elke stap als aandeel van de vorige. Open afspraken tellen niet mee bij gewonnen of verloren.
            </div>
            <Trechterbalken totaal={t} />
          </div>

          {/* ── Verloop ── */}
          {data!.stats.perMaand.length > 1 && (
            <div className="card-base">
              <h2 className="font-semibold mb-1">Verloop per maand</h2>
              <div className="text-xs text-gray-400 mb-3">Gesprekken tegenover geboekte en gewonnen afspraken</div>
              <ResponsiveContainer width="100%" height={260}>
                <ComposedChart data={data!.stats.perMaand} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="maand" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <Tooltip labelStyle={{ fontWeight: 600 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="gesprekken" name="Gesprekken" fill="#e5e7eb" radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="r" dataKey="afspraken" name="Afspraken" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                  <Line yAxisId="r" type="monotone" dataKey="gewonnen" name="Gewonnen" stroke="#16a34a" strokeWidth={2} dot={{ r: 3 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Wanneer bellen ── */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="card-base">
              <h2 className="font-semibold mb-1">Per weekdag</h2>
              <div className="text-xs text-gray-400 mb-3">Wanneer wordt er gebeld, en wanneer levert het op?</div>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart data={data!.stats.perWeekdag} margin={{ top: 4, right: 8, left: 8, bottom: 4 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="dag" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <Tooltip labelStyle={{ fontWeight: 600 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="gesprekken" name="Gesprekken" fill="#e5e7eb" radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="r" dataKey="afspraken" name="Afspraken" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="card-base">
              <h2 className="font-semibold mb-1">Per uur</h2>
              <div className="text-xs text-gray-400 mb-3">Belgische tijd · alleen uren waarin er iets gebeurde</div>
              <ResponsiveContainer width="100%" height={220}>
                <ComposedChart
                  data={data!.stats.perUur.filter((u) => u.gesprekken > 0 || u.afspraken > 0)}
                  margin={{ top: 4, right: 8, left: 8, bottom: 4 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="uur" tickFormatter={(u: number) => `${u}u`} tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="l" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                  <Tooltip labelFormatter={(u) => `${u}u — ${Number(u) + 1}u`} labelStyle={{ fontWeight: 600 }} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="gesprekken" name="Gesprekken" fill="#e5e7eb" radius={[3, 3, 0, 0]} />
                  <Bar yAxisId="r" dataKey="afspraken" name="Afspraken" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* ── Tabellen ── */}
          {data!.isAdmin && (
            <Tabel titel="Per setter" uitleg="Wie boekt, en wie boekt afspraken die ook doorgaan." groepen={data!.stats.perSetter} eersteKop="Setter" />
          )}
          <Tabel
            titel="Per sector"
            uitleg="Waar zit de beste conversie? Sectoren met weinig gesprekken zeggen weinig — kijk naar het aantal ernaast."
            groepen={data!.stats.perSector}
            eersteKop="Sector"
          />
          <Tabel titel="Per bron" uitleg="Waar de leads vandaan komen." groepen={data!.stats.perBron} eersteKop="Bron" />

          {data!.stats.verliesredenen.length > 0 && (
            <div className="card-base">
              <h2 className="font-semibold mb-1">Waarom ging het niet door?</h2>
              <div className="text-xs text-gray-400 mb-3">Reden bij de verloren afspraken</div>
              <div className="space-y-1.5">
                {data!.stats.verliesredenen.map((r) => {
                  const grootste = data!.stats.verliesredenen[0].aantal
                  return (
                    <div key={r.reden} className="flex items-center gap-3 text-sm">
                      <span className="w-56 shrink-0 truncate" title={r.reden}>{r.reden}</span>
                      <div className="flex-1 h-4 bg-gray-100 rounded overflow-hidden">
                        <div className="h-full bg-red-400 rounded" style={{ width: `${(r.aantal / grootste) * 100}%` }} />
                      </div>
                      <span className="w-8 text-right tabular-nums text-gray-500">{r.aantal}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {t.gesprekken === 0 && t.afspraken === 0 && (
            <p className="text-sm text-gray-500 border border-gray-200 rounded-2xl px-4 py-12 text-center">
              Geen gesprekken of afspraken in deze periode.
            </p>
          )}
        </>
      )}
    </div>
  )
}

function Kaart({ label, waarde, onder, accent }: {
  label: string; waarde: string; onder?: string; accent?: boolean
}) {
  return (
    <div className={cn('card-base', accent && 'ring-2 ring-[#fff848]')}>
      <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1 tabular-nums">{waarde}</div>
      {onder && <div className="text-[11px] text-gray-400 mt-0.5">{onder}</div>}
    </div>
  )
}

/** De trechter als staven, elk als aandeel van de vorige stap. */
function Trechterbalken({ totaal }: { totaal: Statistieken['totaal'] }) {
  const stappen = [
    { label: 'Gesprekken', waarde: totaal.gesprekken, van: null as number | null, kleur: 'bg-gray-300' },
    { label: 'Unieke leads gebeld', waarde: totaal.leadsGebeld, van: totaal.gesprekken, kleur: 'bg-gray-400' },
    { label: 'Afspraken geboekt', waarde: totaal.afspraken, van: totaal.leadsGebeld, kleur: 'bg-blue-400' },
    { label: 'Afspraak doorgegaan', waarde: totaal.doorgegaan, van: totaal.afspraken, kleur: 'bg-blue-500' },
    { label: 'Gewonnen', waarde: totaal.gewonnen, van: totaal.doorgegaan, kleur: 'bg-green-500' },
  ]
  const grootste = Math.max(...stappen.map((s) => s.waarde), 1)

  return (
    <div className="space-y-2">
      {stappen.map((s) => (
        <div key={s.label} className="flex items-center gap-3 text-sm">
          <span className="w-44 shrink-0 text-gray-600">{s.label}</span>
          <div className="flex-1 h-6 bg-gray-50 rounded overflow-hidden">
            <div className={cn('h-full rounded', s.kleur)} style={{ width: `${(s.waarde / grootste) * 100}%` }} />
          </div>
          <span className="w-14 text-right tabular-nums font-semibold">{getal.format(s.waarde)}</span>
          <span className="w-16 text-right tabular-nums text-xs text-gray-400">
            {s.van === null ? '' : toonPercentage(percentage(s.waarde, s.van))}
          </span>
        </div>
      ))}
    </div>
  )
}

type Kolom = {
  kop: string
  titel?: string
  waarde: (g: Groep) => number | null
  toon: (g: Groep) => string
}

const KOLOMMEN: Kolom[] = [
  { kop: 'Gesprekken', waarde: (g) => g.gesprekken, toon: (g) => getal.format(g.gesprekken) },
  { kop: 'Leads', titel: 'Unieke leads waarmee gebeld is', waarde: (g) => g.leadsGebeld, toon: (g) => getal.format(g.leadsGebeld) },
  { kop: 'Afspraken', waarde: (g) => g.afspraken, toon: (g) => getal.format(g.afspraken) },
  {
    kop: 'Boeking', titel: 'Afspraken per gesprek',
    waarde: (g) => percentage(g.afspraken, g.gesprekken),
    toon: (g) => toonPercentage(percentage(g.afspraken, g.gesprekken)),
  },
  {
    kop: 'Opkomst', titel: 'Afspraken die doorgingen',
    waarde: (g) => percentage(g.doorgegaan, g.afspraken),
    toon: (g) => toonPercentage(percentage(g.doorgegaan, g.afspraken)),
  },
  { kop: 'Gewonnen', waarde: (g) => g.gewonnen, toon: (g) => getal.format(g.gewonnen) },
  {
    kop: 'Sluiting', titel: 'Gewonnen van de besliste afspraken — open afspraken tellen niet mee',
    waarde: (g) => percentage(g.gewonnen, g.gewonnen + g.verloren),
    toon: (g) => toonPercentage(percentage(g.gewonnen, g.gewonnen + g.verloren)),
  },
  { kop: 'Waarde', waarde: (g) => g.dealWaardeCent, toon: (g) => euro.format(g.dealWaardeCent / 100) },
]

function Tabel({ titel, uitleg, groepen, eersteKop }: {
  titel: string; uitleg: string; groepen: Groep[]; eersteKop: string
}) {
  const [sorteerOp, setSorteerOp] = useState<number | null>(null)
  const [omgekeerd, setOmgekeerd] = useState(false)

  const rijen = useMemo(() => {
    if (sorteerOp === null) return groepen
    const kolom = KOLOMMEN[sorteerOp]
    return [...groepen].sort((a, b) => {
      // Een leeg percentage (niets om over te rekenen) hoort onderaan, niet
      // bovenaan als "0".
      const va = kolom.waarde(a)
      const vb = kolom.waarde(b)
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      return omgekeerd ? va - vb : vb - va
    })
  }, [groepen, sorteerOp, omgekeerd])

  if (groepen.length === 0) return null

  const klik = (i: number) => {
    if (sorteerOp === i) setOmgekeerd((o) => !o)
    else { setSorteerOp(i); setOmgekeerd(false) }
  }

  return (
    <div className="card-base">
      <h2 className="font-semibold mb-1">{titel}</h2>
      <div className="text-xs text-gray-400 mb-3">{uitleg}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
              <th className="text-left font-semibold py-2 pr-3">{eersteKop}</th>
              {KOLOMMEN.map((k, i) => (
                <th key={k.kop} className="text-right font-semibold py-2 px-2 whitespace-nowrap">
                  <button
                    onClick={() => klik(i)}
                    title={k.titel}
                    className="inline-flex items-center gap-1 hover:text-gray-700"
                  >
                    {k.kop}
                    {sorteerOp === i && (omgekeerd ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rijen.map((g) => (
              <tr key={g.sleutel} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
                <td className="py-2 pr-3 font-medium">{g.label}</td>
                {KOLOMMEN.map((k) => (
                  <td key={k.kop} className="text-right py-2 px-2 tabular-nums whitespace-nowrap">
                    {k.toon(g)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-3 flex items-center gap-1.5">
        <TrendingUp className="h-3 w-3" />
        Klik op een kolomkop om te sorteren.
      </p>
    </div>
  )
}
