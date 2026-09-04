'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, ChevronLeft, ChevronRight, Trophy, CalendarCheck, Clock, Euro, Check, Receipt,
} from 'lucide-react'
import { euro, hoursText, monthLabel, withVat, VAT_PCT } from '@/lib/sales/earnings'
import { TimerCard } from './timer-card'
import { TimeEntries } from './time-entries'

type Stat = {
  setter: { id: string; name: string; hourly_rate_cents: number; commission_pct: number }
  seconds: number
  earnedCents: number
  closedSeconds: number
  closedEarnedCents: number
  runningSince: string | null
  appointments: number
  won: number
  lost: number
  open: number
  dealValueCents: number
  commissionCents: number
  totalCents: number
}
type Payout = {
  setterId: string; setterName: string; month: string
  kind: 'hours' | 'commission'
  amountCents: number; status: 'open' | 'paid'; paidAt: string | null
}

const monthParam = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`

/**
 * Resultaten van de appointment setters.
 *
 * Eén scherm voor twee soorten mensen: een admin ziet iedereen en kan
 * uitbetalingen afvinken, een setter ziet enkel zijn eigen cijfers plus zijn
 * timer. Wat je te zien krijgt wordt op de SERVER bepaald, niet hier.
 */
export function ResultsClient() {
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const [stats, setStats] = useState<Stat[]>([])
  const [payouts, setPayouts] = useState<Payout[]>([])
  const [isAdmin, setIsAdmin] = useState(false)
  const [meId, setMeId] = useState<string | null>(null)
  const [focus, setFocus] = useState('')          // admin: één setter uitlichten
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ month: monthParam(month) })
      if (focus) p.set('setter', focus)
      const r = await fetch(`/api/admin/sales/stats?${p}`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setStats(j.stats ?? [])
      setIsAdmin(!!j.isAdmin)
      setMeId(j.meId ?? null)

      if (j.isAdmin) {
        const rp = await fetch(`/api/admin/sales/payouts?month=${monthParam(month)}`, { cache: 'no-store' })
        const jp = await rp.json()
        if (rp.ok) setPayouts(jp.payouts ?? [])
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
    finally { setLoading(false) }
  }, [month, focus])
  useEffect(() => { load() }, [load])

  const mine = meId ? stats.find((s) => s.setter.id === meId) : stats[0]
  const totals = stats.reduce((acc, s) => ({
    seconds: acc.seconds + s.seconds,
    earned: acc.earned + s.earnedCents,
    commission: acc.commission + s.commissionCents,
    appointments: acc.appointments + s.appointments,
    won: acc.won + s.won,
    deal: acc.deal + s.dealValueCents,
  }), { seconds: 0, earned: 0, commission: 0, appointments: 0, won: 0, deal: 0 })

  const markPaid = async (p: Payout, paid: boolean) => {
    try {
      const r = await fetch('/api/admin/sales/payouts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setterId: p.setterId, month: p.month, kind: p.kind, paid }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(paid ? 'Op betaald gezet.' : 'Weer opengezet.')
      load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }

  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1))

  return (
    <div className="space-y-4">
      {/* Maandkeuze */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button onClick={() => shift(-1)} className="btn-secondary px-2" aria-label="Vorige maand"><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={() => setMonth(new Date(new Date().getFullYear(), new Date().getMonth(), 1))} className="btn-secondary text-sm">
            Deze maand
          </button>
          <button onClick={() => shift(1)} className="btn-secondary px-2" aria-label="Volgende maand"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <span className="text-sm font-medium capitalize">{monthLabel(monthParam(month))}</span>

        {isAdmin && stats.length > 0 && (
          <select className="input-base w-auto text-sm ml-auto" value={focus} onChange={(e) => setFocus(e.target.value)}>
            <option value="">Alle setters</option>
            {stats.map((s) => <option key={s.setter.id} value={s.setter.id}>{s.setter.name}</option>)}
          </select>
        )}
      </div>

      {/* De timer is enkel voor wie zelf belt. */}
      {/* ZONDER de lopende sessie: die telt de kaart er zelf per seconde bij. */}
      {!isAdmin && <TimerCard alreadyEarnedCents={mine?.closedEarnedCents ?? 0} onChanged={load} />}

      {loading ? (
        <div className="card-base py-12 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : stats.length === 0 ? (
        <div className="card-base text-sm text-gray-500">
          Nog geen cijfers voor deze maand. Zodra er gebeld en geboekt wordt, verschijnt hier alles.
        </div>
      ) : (
        <>
          {/* Kerncijfers */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile icon={Clock} label="Gebeld" value={hoursText(totals.seconds)} sub={euro(totals.earned)} />
            <Tile icon={CalendarCheck} label="Afspraken" value={String(totals.appointments)} sub={`${totals.won} gewonnen`} />
            <Tile icon={Euro} label="Omzet eerste contracten" value={euro(totals.deal)} sub={`${euro(totals.commission)} commissie`} />
            <Tile icon={Trophy} label={isAdmin ? 'Te betalen' : 'Jouw verdiensten'}
              value={euro(totals.earned + totals.commission)} sub="uren + commissie" accent />
          </div>

          {/* Per setter */}
          <div className="card-base p-0 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold">
              {isAdmin ? 'Per appointment setter' : 'Jouw cijfers'}
            </div>
            <div className="table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="table-th">Setter</th>
                    <th className="table-th">Gebeld</th>
                    <th className="table-th">Afspraken</th>
                    <th className="table-th">Gewonnen</th>
                    <th className="table-th">Verloren</th>
                    <th className="table-th">Uren</th>
                    <th className="table-th">Commissie</th>
                    <th className="table-th">Totaal</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {stats.map((s) => (
                    <tr key={s.setter.id} className="hover:bg-gray-50">
                      <td className="table-td">
                        <div className="font-medium flex items-center gap-2">
                          {s.setter.name}
                          {s.runningSince && (
                            <span className="status-badge bg-green-100 text-green-700">bezig</span>
                          )}
                        </div>
                        <div className="text-[11px] text-gray-500">
                          {euro(s.setter.hourly_rate_cents)}/u · {Number(s.setter.commission_pct)}%
                        </div>
                      </td>
                      <td className="table-td tabular">{hoursText(s.seconds)}</td>
                      <td className="table-td tabular">{s.appointments}</td>
                      <td className="table-td tabular text-green-700">{s.won}</td>
                      <td className="table-td tabular text-gray-500">{s.lost}</td>
                      <td className="table-td tabular">{euro(s.earnedCents)}</td>
                      <td className="table-td tabular">{euro(s.commissionCents)}</td>
                      <td className="table-td tabular font-semibold">{euro(s.totalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Wat de setter zelf moet factureren. Staat bewust HIER en niet bij
              Facturen: dat scherm gaat over wat wij aan klanten sturen. */}
          {(!isAdmin || focus) && (() => {
            const s = focus ? stats.find((x) => x.setter.id === focus) : mine
            if (!s) return null
            const rows = [
              { label: `Gewerkte uren — ${hoursText(s.seconds)}`, cents: s.earnedCents },
              { label: `Commissie — ${s.won} contract(en) à ${Number(s.setter.commission_pct)}%`, cents: s.commissionCents },
            ].filter((r) => r.cents > 0)
            const totalExcl = rows.reduce((sum, r) => sum + r.cents, 0)
            if (totalExcl === 0) return null

            return (
              <div className="card-base">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                  <div>
                    <h2 className="font-semibold text-gray-900 flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-gray-400" />
                      {isAdmin ? `Wat ${s.setter.name} factureert` : 'Wat jij factureert aan NextGenMedia'}
                    </h2>
                    <p className="text-sm text-gray-500 mt-0.5 capitalize">{monthLabel(monthParam(month))}</p>
                  </div>
                </div>

                <div className="table-wrap">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="table-th">Omschrijving</th>
                        <th className="table-th text-right">Excl. btw</th>
                        <th className="table-th text-right">Incl. {VAT_PCT}% btw</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {rows.map((r) => (
                        <tr key={r.label}>
                          <td className="table-td">{r.label}</td>
                          <td className="table-td text-right tabular">{euro(r.cents)}</td>
                          <td className="table-td text-right tabular">{euro(withVat(r.cents))}</td>
                        </tr>
                      ))}
                      <tr className="bg-[#fff848]/15">
                        <td className="table-td font-semibold">Totaal te factureren</td>
                        <td className="table-td text-right tabular font-semibold">{euro(totalExcl)}</td>
                        <td className="table-td text-right tabular font-semibold">{euro(withVat(totalExcl))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <p className="text-[11px] text-gray-500 mt-3">
                  Bedragen excl. btw zijn wat er afgesproken is; het btw-bedrag is berekend aan {VAT_PCT}%.
                  Val je onder de vrijstelling voor kleine ondernemingen, dan factureer je enkel de kolom
                  zonder btw. Zolang de maand loopt kan dit nog oplopen.
                </p>
              </div>
            )
          })()}

          {/* De losse belperiodes, met de mogelijkheid er een te wissen.
              Bij "alle setters" tonen we ze niet: dan wordt het een onleesbare
              hoop. Kies eerst iemand, dan zie je diens periodes. */}
          {(!isAdmin || focus) && (
            <TimeEntries
              month={monthParam(month)}
              setterId={focus || undefined}
              hourlyRateCents={(focus ? stats.find((x) => x.setter.id === focus) : mine)?.setter.hourly_rate_cents ?? 5000}
              onChanged={load}
            />
          )}

          {isAdmin && !focus && (
            <p className="text-[11px] text-gray-500">
              Kies hierboven een setter om zijn belperiodes te zien en er eventueel een te verwijderen.
            </p>
          )}

          {/* Afrekeningen — enkel voor de admin */}
          {isAdmin && payouts.length > 0 && (
            <div className="card-base p-0 overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="text-sm font-semibold">Uit te betalen — {monthLabel(monthParam(month))}</div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Twee aparte afrekeningen per persoon: gewerkte uren en commissie. Zet je iets op betaald,
                  dan blijft dat bedrag staan zoals het op dat moment was.
                </p>
              </div>
              <div className="divide-y divide-gray-50">
                {payouts.map((p) => (
                  <div key={`${p.setterId}-${p.kind}`} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium truncate">
                        {p.setterName} — {p.kind === 'hours' ? 'gewerkte uren' : 'commissie'}
                      </div>
                      {p.paidAt && (
                        <div className="text-[11px] text-gray-500">
                          betaald op {new Date(p.paidAt).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long' })}
                        </div>
                      )}
                    </div>
                    <div className="tabular font-semibold">{euro(p.amountCents)}</div>
                    <button
                      onClick={() => markPaid(p, p.status !== 'paid')}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors ${
                        p.status === 'paid'
                          ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'}`}>
                      {p.status === 'paid' ? <><Check className="h-3.5 w-3.5" />Betaald</> : 'Op betaald zetten'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Tile({ icon: Icon, label, value, sub, accent }: {
  icon: typeof Clock; label: string; value: string; sub?: string; accent?: boolean
}) {
  return (
    <div className={`stat-card ${accent ? 'border-[#fff848] bg-[#fff848]/10' : ''}`}>
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-gray-500 mb-1">
        <Icon className="h-3.5 w-3.5" />{label}
      </div>
      <div className="text-2xl font-bold tabular tracking-tight">{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}
