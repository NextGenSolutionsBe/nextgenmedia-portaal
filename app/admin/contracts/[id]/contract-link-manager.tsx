'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw, CalendarClock, Save } from 'lucide-react'
import { toast } from 'sonner'

// Beheer van de publieke tekenlink: vervaldatum instellen + nieuwe token genereren.
export function ContractLinkManager({
  contractId, initialExpiresAt,
}: { contractId: string; initialExpiresAt: string | null }) {
  const router = useRouter()
  const [expiresAt, setExpiresAt] = useState(initialExpiresAt ? initialExpiresAt.slice(0, 10) : '')
  const [savingExpiry, setSavingExpiry] = useState(false)
  const [regenerating, setRegenerating] = useState(false)

  const saveExpiry = async () => {
    setSavingExpiry(true)
    try {
      const res = await fetch(`/api/admin/contracts/${contractId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_expiry', expires_at: expiresAt || null }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success(expiresAt ? 'Vervaldatum opgeslagen' : 'Vervaldatum gewist')
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setSavingExpiry(false) }
  }

  const regenerate = async () => {
    if (!confirm('Nieuwe tekenlink genereren? De oude link werkt dan niet meer.')) return
    setRegenerating(true)
    try {
      const res = await fetch(`/api/admin/contracts/${contractId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'regenerate_token' }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('Nieuwe tekenlink gegenereerd')
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setRegenerating(false) }
  }

  return (
    <div className="card-base space-y-3">
      <h2 className="font-semibold text-sm flex items-center gap-2">
        <CalendarClock className="h-4 w-4 text-gray-400" />
        Tekenlink-instellingen
      </h2>
      <div>
        <label className="block text-xs text-gray-500 mb-1">Vervaldatum (optioneel)</label>
        <div className="flex gap-2">
          <input
            type="date"
            className="flex-1 px-2 py-1.5 text-sm border border-gray-200 rounded-lg"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
          <button onClick={saveExpiry} disabled={savingExpiry} className="btn-secondary px-2">
            {savingExpiry ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          </button>
        </div>
        <p className="text-[11px] text-gray-400 mt-1">Na deze datum is de tekenlink verlopen en kan er niet meer getekend worden.</p>
      </div>
      <button onClick={regenerate} disabled={regenerating} className="btn-secondary w-full justify-center text-sm">
        {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        Nieuwe tekenlink genereren
      </button>
    </div>
  )
}
