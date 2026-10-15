'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Play, Square, Timer } from 'lucide-react'
import { clockText, liveEuro, euro, earnedCents } from '@/lib/sales/earnings'

type Running = { id: string; startedAt: string }
type Me = { id: string; name: string; hourlyRateCents: number; commissionPct: number }

/**
 * De timer van de appointment setter, met de verdiensten die live meelopen.
 *
 * Het begintijdstip komt van de SERVER. De browser telt alleen op vanaf dat
 * moment — een klok die je zelf kunt verzetten hoort niet te bepalen wat er
 * uitbetaald wordt.
 *
 * `alreadyEarnedCents` is wat er deze maand al vaststaat uit afgesloten blokken;
 * de lopende sessie komt daarbovenop. Zo klopt de teller met de afrekening.
 */
export function TimerCard({ alreadyEarnedCents, onChanged }: {
  alreadyEarnedCents: number
  onChanged?: () => void
}) {
  const [me, setMe] = useState<Me | null>(null)
  const [running, setRunning] = useState<Running | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [, setTick] = useState(0)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/admin/sales/timer', { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setMe(j.setter ?? null)
      setRunning(j.running ?? null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Timer laden mislukt') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  // Eén keer per seconde hertekenen zolang de timer loopt.
  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null }
    if (running) timer.current = setInterval(() => setTick((n) => n + 1), 1000)
    return () => { if (timer.current) clearInterval(timer.current) }
  }, [running])

  const act = async (action: 'start' | 'stop') => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/sales/timer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setRunning(j.running ?? null)
      toast.success(action === 'start' ? 'Timer loopt.' : 'Timer gestopt — de uren staan genoteerd.')
      onChanged?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBusy(false) }
  }

  if (loading) {
    return <div className="card-base py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
  }

  // Onbruikbare starttijd nooit laten doorwerken: dan liever 0 dan "NaN" op
  // het scherm en in de bedragen.
  const startedMs = running ? new Date(running.startedAt).getTime() : NaN
  const seconds = Number.isFinite(startedMs)
    ? Math.max(0, Math.floor((Date.now() - startedMs) / 1000))
    : 0
  const rate = me?.hourlyRateCents ?? 5000
  const sessionCents = earnedCents(seconds, rate)

  return (
    <div className="card-base">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Timer className="h-4 w-4 text-gray-400" />Tijd bijhouden
          </h2>
          <p className="text-sm text-gray-500 mt-0.5">
            {euro(rate)} per uur{me?.commissionPct ? ` · ${me.commissionPct}% op het eerste contract` : ''}
          </p>
        </div>
        {running ? (
          <button onClick={() => act('stop')} disabled={busy} className="btn-danger">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-4 w-4" />}Stoppen
          </button>
        ) : (
          <button onClick={() => act('start')} disabled={busy} className="btn-primary">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Starten
          </button>
        )}
      </div>

      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-200/80 bg-gray-50 p-4">
          <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">Deze sessie</div>
          <div className="text-3xl font-bold tabular tracking-tight">{clockText(seconds)}</div>
          <div className="text-sm text-gray-600 mt-1 tabular">{liveEuro(seconds, rate)}</div>
        </div>
        <div className="rounded-xl border border-[#fff848] bg-[#fff848]/15 p-4">
          <div className="text-[11px] uppercase tracking-wider text-gray-600 mb-1">Deze maand verdiend (uren)</div>
          <div className="text-3xl font-bold tabular tracking-tight">
            {euro(alreadyEarnedCents + sessionCents)}
          </div>
          <div className="text-sm text-gray-600 mt-1">
            {running ? 'Loopt nu op.' : 'De timer staat stil.'}
          </div>
        </div>
      </div>

      {running && (
        <p className="text-[11px] text-gray-500 mt-3">
          {Number.isFinite(startedMs)
            ? `Gestart om ${new Date(startedMs).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })}.`
            : 'De timer loopt.'}{' '}
          Vergeet niet te stoppen als je klaar bent — de teller loopt anders door.
        </p>
      )}
    </div>
  )
}
