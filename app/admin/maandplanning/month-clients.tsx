'use client'

import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, X, Loader2, Trash2, Users, UserPlus, Repeat } from 'lucide-react'
import { MONTH_CLIENT_TYPES, MONTH_FLOW_STEPS, type MonthClientType } from '@/lib/month-phases'

type ClientOpt = { id: string; name: string }
type Entry = { id: string; client_id: string; planning_type: string | null; note: string | null }

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' })
}
const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export function MonthClients({ clients }: { clients: ClientOpt[] }) {
  const [month, setMonth] = useState(thisMonth)
  const [entries, setEntries] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const clientById = new Map(clients.map((c) => [c.id, c]))

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/month-planning-clients?month=${month}`)
      const j = await res.json()
      if (res.ok) setEntries((j.entries ?? []) as Entry[])
    } catch { /* stil */ } finally { setLoading(false) }
  }, [month])

  useEffect(() => { load() }, [load])

  const remove = async (id: string) => {
    setEntries((e) => e.filter((x) => x.id !== id))
    await fetch(`/api/admin/month-planning-clients?id=${id}`, { method: 'DELETE' })
  }

  const groups: { type: MonthClientType; title: string; Icon: typeof UserPlus }[] = [
    { type: 'new', title: 'Nieuwe klanten', Icon: UserPlus },
    { type: 'existing', title: 'Bestaande klanten / Strategie Intake', Icon: Repeat },
  ]

  return (
    <div className="card-base space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Users className="h-4 w-4 text-gray-400" />Klanten deze maand</h2>
          <p className="text-xs text-gray-400 mt-0.5">Een klant in een maand = de volledige contentcyclus voor die klant.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[150px] text-center text-sm font-semibold capitalize">{monthLabel(month)}</span>
          <button onClick={() => setMonth((m) => shiftMonth(m, 1))} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50"><ChevronRight className="h-4 w-4" /></button>
          {month !== thisMonth() && <button onClick={() => setMonth(thisMonth())} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">Deze maand</button>}
          <button onClick={() => setAdding(true)} className="btn-primary text-sm"><Plus className="h-4 w-4" />Klant toevoegen</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {groups.map((g) => {
          const list = entries.filter((e) => (e.planning_type ?? 'new') === g.type)
          return (
            <div key={g.type} className="rounded-xl border border-gray-100 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                <g.Icon className="h-4 w-4 text-gray-400" />{g.title}
                <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded-full">{list.length}</span>
              </div>
              {list.length === 0 ? (
                <p className="text-xs text-gray-300 py-1">Nog geen klanten.</p>
              ) : (
                <div className="space-y-1.5">
                  {list.map((e) => {
                    const c = clientById.get(e.client_id)
                    return (
                      <div key={e.id} className="flex items-start justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
                        <div className="min-w-0">
                          <div className="text-sm font-medium truncate">{c?.name ?? 'Klant'}</div>
                          {e.note && <div className="text-xs text-gray-400 whitespace-pre-wrap">{e.note}</div>}
                        </div>
                        <button onClick={() => remove(e.id)} className="text-gray-300 hover:text-red-500 shrink-0" title="Verwijderen"><Trash2 className="h-3.5 w-3.5" /></button>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <p className="text-[11px] text-gray-400">Volledige cyclus per klant: {MONTH_FLOW_STEPS.join(' → ')}.</p>
      {loading && <p className="text-xs text-gray-400">Laden…</p>}

      {adding && (
        <AddDialog
          month={month}
          clients={clients}
          existingIds={new Set(entries.map((e) => e.client_id))}
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); load() }}
        />
      )}
    </div>
  )
}

function AddDialog({
  month, clients, existingIds, onClose, onAdded,
}: {
  month: string
  clients: ClientOpt[]
  existingIds: Set<string>
  onClose: () => void
  onAdded: () => void
}) {
  const [clientId, setClientId] = useState('')
  const [type, setType] = useState<MonthClientType>('new')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const available = clients.filter((c) => !existingIds.has(c.id))

  const submit = async () => {
    if (!clientId) { setError('Kies een klant'); return }
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/admin/month-planning-clients', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan_month: month, client_id: clientId, planning_type: type, note: note || null }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      onAdded()
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout') } finally { setLoading(false) }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold">Klant toevoegen</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Klant</label>
            <select className={inp} value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">— Kies klant —</option>
              {available.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
            <div className="grid grid-cols-1 gap-2">
              {MONTH_CLIENT_TYPES.map((t) => (
                <button key={t.key} type="button" onClick={() => setType(t.key)}
                  className={`text-left rounded-lg border p-3 text-sm transition-colors ${type === t.key ? 'border-[#fff848] bg-[#fff848]/10 ring-1 ring-[#fff848]' : 'border-gray-200 hover:border-gray-300'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notitie (optioneel)</label>
            <textarea rows={2} className={inp} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button onClick={submit} disabled={loading} className="btn-primary flex-1 justify-center">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Toevoegen</button>
            <button onClick={onClose} className="btn-secondary">Annuleer</button>
          </div>
        </div>
      </div>
    </div>
  )
}
