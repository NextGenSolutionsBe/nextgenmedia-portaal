'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, AlertTriangle, Check, Users } from 'lucide-react'
import { toast } from 'sonner'

type Orphan = { id: string; title: string; planned_date: string | null; status: string; created_at: string; client_id: string | null }
type ByClient = { clientId: string; name: string; count: number }
type Client = { id: string; company_name: string }
type Data = { total: number; byClient: ByClient[]; orphanCount: number; orphans: Orphan[]; clients: Client[] }

export function RecoverClient() {
  const [data, setData] = useState<Data | null>(null)
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [targetClient, setTargetClient] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/social-content/recover')
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setData(j)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const toggle = (id: string) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const selectAll = () => setSelected(new Set((data?.orphans ?? []).map((o) => o.id)))

  const reassign = async () => {
    if (!targetClient || selected.size === 0) { toast.error('Kies items én een klant'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/social-content/recover', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: Array.from(selected), clientId: targetClient }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success(`${j.reassigned} item(s) teruggekoppeld.`)
      setSelected(new Set())
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setSaving(false) }
  }

  if (loading) return <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mr-2" />Laden…</div>
  if (!data) return null

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="stat-card"><div className="text-xs text-gray-500">Totaal items in database</div><div className="text-2xl font-bold">{data.total}</div></div>
        <div className="stat-card"><div className="text-xs text-gray-500">Gekoppelde klanten</div><div className="text-2xl font-bold">{data.byClient.length}</div></div>
        <div className="stat-card"><div className="text-xs text-gray-500">Wees-items (geen klant)</div><div className={`text-2xl font-bold ${data.orphanCount > 0 ? 'text-amber-600' : ''}`}>{data.orphanCount}</div></div>
      </div>

      {/* Per klant — zo zie je of je content nog bestaat (ook als de klant uit het menu gefilterd was) */}
      <div className="card-base">
        <h2 className="font-semibold text-gray-900 mb-3 flex items-center gap-2"><Users className="h-4 w-4 text-gray-400" />Content per klant</h2>
        {data.byClient.length === 0 ? (
          <p className="text-sm text-gray-500">Geen gekoppelde content gevonden.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {data.byClient.map((c) => (
              <span key={c.clientId} className="text-sm px-3 py-1.5 rounded-full bg-gray-100 text-gray-700">
                {c.name} <span className="text-gray-400">· {c.count}</span>
              </span>
            ))}
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-2">Staat je content hier onder een klant? Dan is die veilig — open die klant in de contentkalender om ze te zien.</p>
      </div>

      {/* Wees-items terugkoppelen */}
      {data.orphanCount > 0 && (
        <div className="card-base border-amber-200 bg-amber-50/30">
          <div className="flex items-start gap-2 mb-3">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold text-gray-900">{data.orphanCount} wees-item(s) zonder klant</h2>
              <p className="text-xs text-amber-700 mt-0.5">Dit is je verdwenen content. Selecteer de items, kies de juiste klant en klik "Terugkoppelen" — dan verschijnt alles weer in de contentkalender.</p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap mb-3">
            <button onClick={selectAll} className="btn-secondary text-xs">Alles selecteren ({data.orphanCount})</button>
            <select value={targetClient} onChange={(e) => setTargetClient(e.target.value)} className="input-base max-w-xs text-sm">
              <option value="">— kies klant —</option>
              {data.clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
            <button onClick={reassign} disabled={saving || selected.size === 0 || !targetClient} className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Terugkoppelen ({selected.size})
            </button>
          </div>

          <div className="space-y-1 max-h-[420px] overflow-y-auto">
            {data.orphans.map((o) => (
              <label key={o.id} className={`flex items-center gap-3 p-2 rounded-lg border cursor-pointer ${selected.has(o.id) ? 'border-amber-300 bg-amber-50' : 'border-gray-100 hover:bg-gray-50'}`}>
                <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggle(o.id)} />
                <span className="text-sm font-medium flex-1 min-w-0 truncate">{o.title || '(geen titel)'}</span>
                <span className="text-xs text-gray-400 shrink-0">{o.planned_date ?? '—'}</span>
                <span className="status-badge bg-gray-100 text-gray-600 text-[10px] shrink-0">{o.status}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
