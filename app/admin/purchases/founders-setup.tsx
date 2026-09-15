'use client'

import { useState, useEffect } from 'react'
import { Users, Loader2, Check } from 'lucide-react'
import { FOUNDERS } from '@/lib/founders'

export function FoundersSetup() {
  const [existing, setExisting] = useState<string[] | null>(null)
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () => fetch('/api/admin/founders').then(r => r.json()).then(j => setExisting(j.existing ?? [])).catch(() => {})
  useEffect(() => { load() }, [])

  const allExist = existing && existing.length >= FOUNDERS.length
  if (allExist) return null // alle drie bestaan al → kaart verbergen

  const run = async () => {
    if (pw.length < 8) { setError('Wachtwoord van minstens 8 tekens'); return }
    setBusy(true); setError(null); setMsg(null)
    try {
      const res = await fetch('/api/admin/founders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw }) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setMsg('Zaakvoerder-accounts aangemaakt/bijgewerkt.'); setPw(''); load()
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout') } finally { setBusy(false) }
  }

  return (
    <div className="card-base bg-[#fff848]/5 border-[#fff848]/40">
      <h2 className="font-semibold flex items-center gap-2 mb-1"><Users className="h-4 w-4 text-[#c5b800]" />Zaakvoerder-accounts</h2>
      <p className="text-xs text-gray-500 mb-3">Maak de drie admin-accounts aan ({FOUNDERS.map(f => f.email).join(', ')}). Idempotent — bestaande accounts worden niet overschreven, alleen de adminrol gegarandeerd. Het wachtwoord kan elke zaakvoerder later zelf wijzigen.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Initieel wachtwoord (min. 8 tekens)</label>
          <input type="password" value={pw} onChange={e => setPw(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg" placeholder="••••••••" />
        </div>
        <button onClick={run} disabled={busy} className="btn-primary">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Accounts aanmaken</button>
      </div>
      {msg && <div className="text-sm text-green-600 mt-2 flex items-center gap-1"><Check className="h-4 w-4" />{msg}</div>}
      {error && <div className="text-sm text-red-600 mt-2">{error}</div>}
      {existing && existing.length > 0 && <div className="text-[11px] text-gray-400 mt-2">Reeds aangemaakt: {existing.join(', ')}</div>}
    </div>
  )
}
