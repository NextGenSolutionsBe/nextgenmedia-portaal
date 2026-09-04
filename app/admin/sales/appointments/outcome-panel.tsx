'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Loader2, Trophy, XCircle, RotateCcw } from 'lucide-react'
import { commissionCents, euro } from '@/lib/sales/earnings'

/**
 * Gewonnen of verloren afsluiten. Alleen zichtbaar voor een admin: hier hangt
 * de commissie van de setter aan vast, dus dat is niets wat iemand over zijn
 * eigen afspraken beslist.
 */
export function OutcomePanel({ appointmentId, outcome, dealValueCents, commissionPct, onDone }: {
  appointmentId: string
  outcome: 'won' | 'lost' | null
  dealValueCents?: number | null
  commissionPct?: number | null
  onDone: () => void
}) {
  const [mode, setMode] = useState<'won' | 'lost' | null>(outcome)
  const [value, setValue] = useState(dealValueCents ? String(dealValueCents / 100) : '')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const pct = commissionPct ?? 7
  const euros = Number(value.replace(',', '.'))
  const preview = Number.isFinite(euros) && euros > 0
    ? commissionCents(Math.round(euros * 100), pct)
    : 0

  const save = async (next: 'won' | 'lost' | 'open') => {
    setBusy(true)
    try {
      const r = await fetch('/api/admin/sales/outcome', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId, outcome: next, dealValue: value, reason }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(
        next === 'won' ? `Gewonnen — ${euro(j.commissionCents ?? 0)} commissie toegekend.`
        : next === 'lost' ? 'Als verloren afgesloten.'
        : 'Terug op open gezet.',
      )
      onDone()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBusy(false) }
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50 p-3 space-y-2">
      <div className="text-xs font-medium text-gray-700">Afloop van deze afspraak</div>

      <div className="flex gap-1.5">
        <button type="button" onClick={() => setMode('won')} disabled={busy}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            mode === 'won' ? 'bg-green-100 text-green-800 border-green-300' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>
          <Trophy className="h-3.5 w-3.5" />Gewonnen
        </button>
        <button type="button" onClick={() => setMode('lost')} disabled={busy}
          className={`flex-1 inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
            mode === 'lost' ? 'bg-red-100 text-red-800 border-red-300' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>
          <XCircle className="h-3.5 w-3.5" />Verloren
        </button>
        {outcome && (
          <button type="button" onClick={() => save('open')} disabled={busy}
            title="Afloop terugzetten naar open"
            className="px-2 py-1.5 rounded-lg text-xs border border-gray-200 bg-white hover:bg-gray-50">
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {mode === 'won' && (
        <div>
          <label className="block text-[11px] font-medium text-gray-600 mb-1">Waarde eerste contract (€)</label>
          <input className="input-base" inputMode="decimal" value={value}
            onChange={(e) => setValue(e.target.value)} placeholder="6000" />
          <p className="text-[11px] text-gray-500 mt-1">
            {preview > 0
              ? <>Commissie voor de setter: <b>{euro(preview)}</b> ({pct}%).</>
              : <>Hier wordt {pct}% van berekend als commissie voor de setter.</>}
          </p>
          <button onClick={() => save('won')} disabled={busy || preview <= 0} className="btn-primary w-full text-sm mt-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trophy className="h-4 w-4" />}Gewonnen vastleggen
          </button>
        </div>
      )}

      {mode === 'lost' && (
        <div>
          <label className="block text-[11px] font-medium text-gray-600 mb-1">
            Reden <span className="text-gray-400">— optioneel</span>
          </label>
          <input className="input-base" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Bv. te duur, geen budget, timing" />
          <button onClick={() => save('lost')} disabled={busy} className="btn-secondary w-full text-sm mt-2">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}Verloren vastleggen
          </button>
        </div>
      )}
    </div>
  )
}
