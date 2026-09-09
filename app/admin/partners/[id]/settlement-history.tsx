'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Check, Trash2 } from 'lucide-react'
import { formatEuro, formatDate } from '@/lib/utils'

export type Settlement = {
  id: string
  period_start: string
  period_end: string
  net_amount: number
  status: string
  notes: string | null
  finalized_at: string | null
  paid_at: string | null
}

export function SettlementHistory({
  partnerId,
  settlements,
}: {
  partnerId: string
  settlements: Settlement[]
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)

  const markPaid = async (s: Settlement) => {
    setBusy(s.id)
    try {
      const res = await fetch(`/api/admin/partners/${partnerId}/settle`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ settlement_id: s.id, status: 'paid' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fout')
    } finally {
      setBusy(null)
    }
  }

  const remove = async (s: Settlement) => {
    if (!confirm('Deze afrekening definitief verwijderen? De bijbehorende afgerekende posten verdwijnen ook uit de ledger.')) return
    setBusy(s.id)
    try {
      const res = await fetch(`/api/admin/partners/${partnerId}/settle?settlement_id=${s.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fout')
    } finally {
      setBusy(null)
    }
  }

  if (settlements.length === 0) return null

  return (
    <div className="card-base">
      <h2 className="font-semibold mb-4">Afrekenhistorie</h2>
      <div className="space-y-2">
        {settlements.map((s) => {
          const isPaid = s.status === 'paid'
          return (
            <div key={s.id} className="flex items-center justify-between gap-3 py-2.5 px-3 rounded-lg bg-gray-50 flex-wrap">
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  {formatDate(s.period_start)} → {formatDate(s.period_end)}
                </div>
                {s.notes && <div className="text-xs text-gray-400">{s.notes}</div>}
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-sm font-bold ${s.net_amount >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {s.net_amount >= 0 ? 'Wij betalen partner: ' : 'Partner betaalt ons: '}{formatEuro(Math.abs(s.net_amount))}
                </span>
                <span className={`status-badge text-xs ${
                  isPaid ? 'bg-green-100 text-green-700' :
                  s.status === 'finalized' ? 'bg-blue-100 text-blue-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {isPaid ? 'Betaald' : s.status === 'finalized' ? 'Definitief' : 'Concept'}
                </span>

                {!isPaid ? (
                  <button
                    onClick={() => markPaid(s)}
                    disabled={busy === s.id}
                    className="btn-secondary text-xs"
                    title="Markeer als betaald"
                  >
                    {busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    Markeer als betaald
                  </button>
                ) : (
                  <button
                    onClick={() => remove(s)}
                    disabled={busy === s.id}
                    className="text-xs inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
                    title="Afrekening verwijderen"
                  >
                    {busy === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Verwijderen
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
