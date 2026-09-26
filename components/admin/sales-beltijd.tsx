'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Check, Clock, Loader2, Pencil, Play, Plus, Square, Trash2, X } from 'lucide-react'
import {
  beltijdSeconden, brusselNaarUtc, sessieSeconden, toonTimer, toonUren, type BeltijdSessie,
} from '@/lib/sales/beltijd'

/**
 * Beltijd loggen — de compacte start/stop-knop (pipeline) en de volledige kaart
 * (statistieken). Eén databron: /api/admin/sales/beltijd. De timer telt enkel in
 * de browser mee vanaf start_op; de server bewaart start en einde.
 */

type Antwoord = {
  beschikbaar: boolean
  sessies: BeltijdSessie[]
  lopend: BeltijdSessie | null
  medewerkerId: string
  isAdmin: boolean
  meId: string
}

const vandaagBrussel = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const nuTijd = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date())
/** Datum (JJJJ-MM-DD) en klokuur (UU:MM) van een moment, in Brussel — zoals de server ze terugrekent. */
const datumVan = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso))
const tijdVan = (iso: string) => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso))

function useBeltijd(medewerkerId?: string) {
  const [data, setData] = useState<Antwoord | null>(null)
  const [bezig, setBezig] = useState(false)
  const laad = useCallback(async () => {
    try {
      const q = medewerkerId ? `?medewerker=${encodeURIComponent(medewerkerId)}` : ''
      const r = await fetch(`/api/admin/sales/beltijd${q}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'Laden mislukt')
      setData(j as Antwoord)
    } catch { setData(null) }
  }, [medewerkerId])
  useEffect(() => { laad() }, [laad])

  const actie = useCallback(async (body: Record<string, unknown>, ok?: string): Promise<boolean> => {
    setBezig(true)
    try {
      const r = await fetch('/api/admin/sales/beltijd', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, medewerkerId: medewerkerId || undefined }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Opslaan mislukt')
      if (ok) toast.success(ok, { duration: 1500 })
      await laad()
      return true
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukt')
      await laad()
      return false
    } finally { setBezig(false) }
  }, [medewerkerId, laad])

  return { data, bezig, setBezig, laad, actie }
}

/** Seconde-tik zolang er iets loopt. */
function useNu(actief: boolean): number {
  const [nu, setNu] = useState(() => Date.now())
  useEffect(() => {
    if (!actief) return
    setNu(Date.now())
    const t = setInterval(() => setNu(Date.now()), 1000)
    return () => clearInterval(t)
  }, [actief])
  return nu
}

// ── Compacte knop (pipeline-werkbalk) ────────────────────────────────────────
export function BeltijdKnop() {
  const { data, bezig, actie } = useBeltijd()
  const loopt = !!data?.lopend
  const nu = useNu(loopt)
  if (!data || !data.beschikbaar) return null
  const seconden = data.lopend ? sessieSeconden(data.lopend, nu) : 0
  return loopt ? (
    <button onClick={() => actie({ actie: 'stop' }, 'Belsessie gestopt.')} disabled={bezig}
      className="btn-secondary text-sm !border-red-200 !bg-red-50 text-red-700" title="Belsessie stoppen">
      {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
      <span className="tabular-nums">{toonTimer(seconden)}</span>
    </button>
  ) : (
    <button onClick={() => actie({ actie: 'start' }, 'Belsessie gestart.')} disabled={bezig}
      className="btn-secondary text-sm" title="Beltijd loggen: start een belsessie">
      {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Beltijd
    </button>
  )
}

// ── Volledige kaart (statistieken) ───────────────────────────────────────────
export function BeltijdKaart({ medewerkerId, accountNaam, onGewijzigd }: {
  /** Leeg = eigen account. Een admin kan een ander account doorgeven. */
  medewerkerId?: string
  accountNaam?: string | null
  onGewijzigd?: () => void
}) {
  const { data, bezig, setBezig, laad, actie } = useBeltijd(medewerkerId)
  const nu = useNu(!!data?.lopend)
  const [form, setForm] = useState({ datum: vandaagBrussel(), tijd: nuTijd(), minuten: '', notitie: '' })
  const [bewerk, setBewerk] = useState<{ id: string; datum: string; tijd: string; minuten: string; notitie: string } | null>(null)

  const klaar = async (ok: boolean) => { if (ok) onGewijzigd?.() }

  const handmatig = async () => {
    if (!form.minuten.trim()) { toast.error('Geef de duur in minuten.'); return }
    const ok = await actie({ actie: 'handmatig', datum: form.datum, tijd: form.tijd, duurMinuten: form.minuten, notitie: form.notitie }, 'Beltijd gelogd.')
    if (ok) setForm((f) => ({ ...f, minuten: '', notitie: '' }))
    klaar(ok)
  }

  const stuur = async (id: string, method: 'PATCH' | 'DELETE', body?: Record<string, unknown>, ok?: string) => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/sales/beltijd/${id}`, {
        method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined,
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Opslaan mislukt')
      if (ok) toast.success(ok, { duration: 1500 })
      setBewerk(null)
      await laad()
      onGewijzigd?.()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }

  if (!data) {
    return <div className="card-base text-sm text-gray-400 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Beltijd laden…</div>
  }
  if (!data.beschikbaar) {
    return (
      <div className="card-base">
        <h2 className="font-semibold flex items-center gap-2"><Clock className="h-4 w-4" />Beltijd</h2>
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mt-2">
          Beltijd loggen werkt zodra de databankmigratie gedraaid is.
        </p>
      </div>
    )
  }

  const vandaagStart = brusselNaarUtc(vandaagBrussel(), '00:00') ?? new Date()
  const vandaagSec = beltijdSeconden(data.sessies, { van: vandaagStart, nu })
  const weekSec = beltijdSeconden(data.sessies, { nu })
  const lopendSec = data.lopend ? sessieSeconden(data.lopend, nu) : 0
  const lijst = [...data.sessies].sort((a, b) => b.start_op.localeCompare(a.start_op))
  const ander = !!medewerkerId && medewerkerId !== data.meId

  return (
    <div className="card-base space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Clock className="h-4 w-4" />Beltijd{ander && accountNaam ? ` — ${accountNaam}` : ''}</h2>
          <p className="text-xs text-gray-400">Hoe lang er gebeld werd (sessies). Los van de duur per gesprek.</p>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <div><div className="text-[10px] uppercase tracking-wide text-gray-400">Vandaag</div><div className="font-bold tabular-nums">{toonUren(vandaagSec)}</div></div>
          <div><div className="text-[10px] uppercase tracking-wide text-gray-400">Deze week</div><div className="font-bold tabular-nums">{toonUren(weekSec)}</div></div>
        </div>
      </div>

      {/* Timer */}
      <div className={`rounded-xl border px-3 py-2.5 flex items-center justify-between gap-3 ${data.lopend ? 'border-green-200 bg-green-50' : 'border-gray-200'}`}>
        <div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500">{data.lopend ? 'Belsessie loopt sinds ' + new Date(data.lopend.start_op).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' }) : 'Geen lopende sessie'}</div>
          <div className="text-2xl font-bold tabular-nums">{toonTimer(lopendSec)}</div>
        </div>
        {data.lopend ? (
          <button onClick={async () => klaar(await actie({ actie: 'stop' }, 'Belsessie gestopt.'))} disabled={bezig} className="btn-secondary text-sm !border-red-200 text-red-700">
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5" />}Stop
          </button>
        ) : (
          <button onClick={async () => klaar(await actie({ actie: 'start' }, 'Belsessie gestart.'))} disabled={bezig} className="btn-primary text-sm">
            {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-3.5 w-3.5" />}Start belsessie
          </button>
        )}
      </div>

      {/* Handmatig */}
      <form className="grid grid-cols-2 sm:grid-cols-[9rem_6rem_6rem_1fr_auto] gap-2 items-end" onSubmit={(e) => { e.preventDefault(); void handmatig() }}>
        <label className="text-xs text-gray-500">Datum
          <input type="date" className="input-base text-sm mt-1" value={form.datum} max={vandaagBrussel()} onChange={(e) => setForm({ ...form, datum: e.target.value })} />
        </label>
        <label className="text-xs text-gray-500">Start
          <input type="time" className="input-base text-sm mt-1" value={form.tijd} onChange={(e) => setForm({ ...form, tijd: e.target.value })} />
        </label>
        <label className="text-xs text-gray-500">Minuten
          <input className="input-base text-sm mt-1" inputMode="numeric" placeholder="bv. 90" value={form.minuten} onChange={(e) => setForm({ ...form, minuten: e.target.value })} />
        </label>
        <label className="text-xs text-gray-500 col-span-2 sm:col-span-1">Notitie
          <input className="input-base text-sm mt-1" placeholder="optioneel" value={form.notitie} onChange={(e) => setForm({ ...form, notitie: e.target.value })} />
        </label>
        <button type="submit" disabled={bezig} className="btn-secondary text-sm col-span-2 sm:col-span-1"><Plus className="h-4 w-4" />Handmatig loggen</button>
      </form>

      {/* Sessies deze week */}
      <div>
        <div className="text-[11px] uppercase tracking-wide text-gray-400 font-semibold mb-1.5">Sessies deze week</div>
        {lijst.length === 0 ? (
          <p className="text-xs text-gray-400">Nog geen beltijd gelogd deze week.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {lijst.map((s) => (
              <li key={s.id} className="py-1.5 text-sm">
                {bewerk?.id === s.id ? (
                  <form className="grid grid-cols-2 sm:grid-cols-[9rem_6rem_5.5rem_1fr_auto] gap-1.5 items-end"
                    onSubmit={(e) => {
                      e.preventDefault()
                      if (!bewerk.datum || !bewerk.tijd) { toast.error('Kies een datum en een startuur.'); return }
                      if (!bewerk.minuten.trim()) { toast.error('Geef de duur in minuten.'); return }
                      void stuur(s.id, 'PATCH', { datum: bewerk.datum, tijd: bewerk.tijd, duurMinuten: bewerk.minuten, notitie: bewerk.notitie }, 'Sessie aangepast.')
                    }}>
                    <label className="text-[11px] text-gray-500">Datum
                      <input type="date" autoFocus className="input-base text-sm mt-0.5" value={bewerk.datum} max={vandaagBrussel()} onChange={(e) => setBewerk({ ...bewerk, datum: e.target.value })} />
                    </label>
                    <label className="text-[11px] text-gray-500">Start
                      <input type="time" className="input-base text-sm mt-0.5" value={bewerk.tijd} onChange={(e) => setBewerk({ ...bewerk, tijd: e.target.value })} />
                    </label>
                    <label className="text-[11px] text-gray-500">Minuten
                      <input className="input-base text-sm mt-0.5" inputMode="numeric" value={bewerk.minuten} onChange={(e) => setBewerk({ ...bewerk, minuten: e.target.value })} />
                    </label>
                    <label className="text-[11px] text-gray-500">Notitie
                      <input className="input-base text-sm mt-0.5" value={bewerk.notitie} placeholder="optioneel" onChange={(e) => setBewerk({ ...bewerk, notitie: e.target.value })} />
                    </label>
                    <div className="flex gap-1.5 col-span-2 sm:col-span-1">
                      <button type="submit" disabled={bezig} className="h-9 w-9 flex items-center justify-center rounded-lg bg-black text-white" title="Bewaren"><Check className="h-4 w-4" /></button>
                      <button type="button" onClick={() => setBewerk(null)} className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-gray-100" title="Annuleren"><X className="h-4 w-4" /></button>
                    </div>
                  </form>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
                    <span className="text-gray-500 w-32 shrink-0 tabular-nums">
                      {new Date(s.start_op).toLocaleString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className={`font-semibold tabular-nums w-24 shrink-0 ${!s.einde_op ? 'text-green-700' : ''}`}>
                      {s.einde_op ? toonUren(sessieSeconden(s, nu)) : 'loopt…'}
                    </span>
                    <span className="text-gray-600 truncate flex-1 min-w-0">{s.notitie}</span>
                    {s.einde_op && (
                      <button onClick={() => setBewerk({ id: s.id, datum: datumVan(s.start_op), tijd: tijdVan(s.start_op), minuten: String(Math.round(sessieSeconden(s, nu) / 60)), notitie: s.notitie ?? '' })} disabled={bezig}
                        className="h-7 w-7 flex items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-black" title="Aanpassen"><Pencil className="h-3.5 w-3.5" /></button>
                    )}
                    <button onClick={() => { if (window.confirm('Deze sessie verwijderen? Ze telt daarna niet meer mee.')) void stuur(s.id, 'DELETE', undefined, 'Sessie verwijderd.') }} disabled={bezig}
                      className="h-7 w-7 flex items-center justify-center rounded-md text-red-500 hover:bg-red-50 hover:text-red-700" title="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
