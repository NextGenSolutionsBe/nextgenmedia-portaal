'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Users, Check, Info } from 'lucide-react'

type Setter = {
  id: string
  name: string
  email: string | null
  hourly_rate_cents: number
  commission_pct: number
  active: boolean
  onbezoldigd?: boolean
}

/**
 * Uurtarief en commissie per setter.
 *
 * Staat hier, bij Resultaten, en niet in een apart instellingenscherm: dit is
 * precies de pagina waar je die bedragen ziet terugkomen in de afrekening.
 *
 * "Geen vergoeding" is er voor een zaakvoerder die zelf belt. Dat is iets
 * anders dan €0 invullen: het legt de bedoeling vast, zodat niemand later
 * denkt dat het veld gewoon nog leeg stond.
 */
export function SetterTarieven() {
  const [rijen, setRijen] = useState<Setter[]>([])
  const [laden, setLaden] = useState(true)
  const [bezig, setBezig] = useState<string | null>(null)

  const laad = useCallback(async () => {
    setLaden(true)
    try {
      const res = await fetch('/api/admin/sales/setters')
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setRijen(j.setters ?? [])
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLaden(false) }
  }, [])
  useEffect(() => { laad() }, [laad])

  const bewaar = async (s: Setter, patch: Record<string, unknown>) => {
    setBezig(s.id)
    try {
      const res = await fetch('/api/admin/sales/setters', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: s.id, ...patch }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      if (j.warning) toast.warning(j.warning, { duration: 10000 })
      else toast.success('Opgeslagen.')
      laad()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(null) }
  }

  if (laden) return <div className="py-8 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>

  return (
    <div className="space-y-3 border-t border-gray-200 pt-8">
      <div>
        <h2 className="text-lg font-bold flex items-center gap-2">
          <Users className="h-5 w-5" />Tarieven per setter
        </h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Wat iemand per uur verdient en welk percentage hij krijgt op een eerste contract.
          Deze bedragen bepalen de afrekening hierboven én de setterkost in de financiën.
        </p>
      </div>

      <div className="space-y-2">
        {rijen.map((s) => (
          <Rij key={s.id} s={s} bezig={bezig === s.id} onBewaar={(p) => bewaar(s, p)} />
        ))}
        {rijen.length === 0 && (
          <p className="text-sm text-gray-500">
            Nog geen setters. Een profiel ontstaat vanzelf zodra iemand zijn eerste afspraak boekt.
          </p>
        )}
      </div>
    </div>
  )
}

function Rij({ s, bezig, onBewaar }: {
  s: Setter; bezig: boolean; onBewaar: (patch: Record<string, unknown>) => void
}) {
  const [tarief, setTarief] = useState(String(s.hourly_rate_cents / 100))
  const [commissie, setCommissie] = useState(String(s.commission_pct))
  const gewijzigd = tarief !== String(s.hourly_rate_cents / 100) || commissie !== String(s.commission_pct)

  return (
    <div className={`card-base p-3 ${s.onbezoldigd ? 'bg-gray-50' : ''}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <div className="font-medium text-sm">{s.name}</div>
          {s.email && <div className="text-xs text-gray-500">{s.email}</div>}
        </div>

        {s.onbezoldigd ? (
          <span className="text-xs text-gray-600 bg-gray-100 border border-gray-200 rounded-lg px-2.5 py-1.5">
            Geen vergoeding — telt niet mee in de afrekening of de kosten
          </span>
        ) : (
          <>
            <label className="text-xs text-gray-600 flex items-center gap-1.5">
              Uurtarief
              <input className="input-base w-24 text-right" value={tarief} inputMode="decimal"
                onChange={(e) => setTarief(e.target.value)} />
              <span className="text-gray-400">€/u</span>
            </label>
            <label className="text-xs text-gray-600 flex items-center gap-1.5">
              Commissie
              <input className="input-base w-20 text-right" value={commissie} inputMode="decimal"
                onChange={(e) => setCommissie(e.target.value)} />
              <span className="text-gray-400">%</span>
            </label>
            <button onClick={() => onBewaar({ uurtarief: tarief, commissie })}
              disabled={bezig || !gewijzigd} className="btn-secondary text-sm">
              {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Opslaan
            </button>
          </>
        )}
      </div>

      <label className="flex items-start gap-2 mt-2 cursor-pointer">
        <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-[#fff848]"
          checked={!!s.onbezoldigd} disabled={bezig}
          onChange={(e) => onBewaar({ onbezoldigd: e.target.checked })} />
        <span className="text-[11px] text-gray-500 flex items-start gap-1">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          Geen vergoeding — voor een zaakvoerder die zelf belt. Uurtarief en commissie gaan
          op nul en deze persoon verschijnt niet in de uit te betalen bedragen.
        </span>
      </label>
    </div>
  )
}
