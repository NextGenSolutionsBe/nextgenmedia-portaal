'use client'

import { useCallback, useEffect, useState } from 'react'
import { CalendarRange, Plus, Trash2, Loader2, X, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { MONTH_CLIENT_TYPES, MONTH_CLIENT_TYPE_LABEL, type MonthClientType } from '@/lib/month-phases'
import { Bevestig } from '@/app/admin/instellingen/ui'
import { EntryEditDialog } from '@/app/admin/maandplanning/entry-edit-dialog'

type Entry = { id: string; plan_month: string; planning_type: string | null; note: string | null }

const monthLabel = (ym: string) => {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' })
}
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export function ClientMonths({ clientId }: { clientId: string }) {
  const [entries, setEntries] = useState<Entry[]>([])
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [bewerk, setBewerk] = useState<Entry | null>(null)
  const [teVerwijderen, setTeVerwijderen] = useState<Entry | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/month-planning-clients?client_id=${clientId}`)
      const j = await res.json()
      if (res.ok) setEntries((j.entries ?? []) as Entry[])
    } catch { /* stil */ }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const remove = async (id: string) => {
    setBusy(id)
    try {
      const res = await fetch(`/api/admin/month-planning-clients?id=${id}`, { method: 'DELETE' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Verwijderen mislukt')
      setEntries((e) => e.filter((x) => x.id !== id))
      setTeVerwijderen(null)
      toast.success('Maandplanning verwijderd')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt')
    } finally { setBusy(null) }
  }

  return (
    <div className="card-base space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm text-gray-900 flex items-center gap-2"><CalendarRange className="h-4 w-4 text-gray-400" />Gepland in maanden</h2>
        <button onClick={() => setAdding(true)} className="text-xs text-gray-500 hover:text-black inline-flex items-center gap-1"><Plus className="h-3.5 w-3.5" />Toevoegen</button>
      </div>

      {entries.length === 0 ? (
        <p className="text-sm text-gray-400">Nog niet ingepland.</p>
      ) : (
        <div className="space-y-1.5">
          {entries.map((e) => (
            <div key={e.id} className="flex items-start justify-between gap-2 rounded-lg bg-gray-50 px-3 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium capitalize">{monthLabel(e.plan_month)}</div>
                <div className="text-xs text-gray-500">{MONTH_CLIENT_TYPE_LABEL[e.planning_type ?? 'new'] ?? 'Nieuwe klant'}</div>
                {e.note && <div className="text-xs text-gray-400 whitespace-pre-wrap mt-0.5">{e.note}</div>}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => setBewerk(e)} className="h-7 w-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700" title="Bewerken"><Pencil className="h-3.5 w-3.5" /></button>
                <button onClick={() => setTeVerwijderen(e)} disabled={busy === e.id} className="h-7 w-7 flex items-center justify-center rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600" title="Verwijderen">
                  {busy === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {bewerk && (
        <EntryEditDialog
          entry={bewerk}
          titel={`Maandplanning — ${monthLabel(bewerk.plan_month)}`}
          onClose={() => setBewerk(null)}
          onSaved={(p) => { setEntries((es) => es.map((x) => x.id === bewerk.id ? { ...x, ...p } : x)); setBewerk(null) }}
        />
      )}

      {teVerwijderen && (
        <Bevestig titel="Maandplanning verwijderen" gevaarlijk bevestigLabel="Verwijderen" bezig={busy === teVerwijderen.id}
          tekst={<>Deze klant uit de planning van <strong>{monthLabel(teVerwijderen.plan_month)}</strong> verwijderen?</>}
          onBevestig={() => remove(teVerwijderen.id)} onAnnuleer={() => setTeVerwijderen(null)} />
      )}

      {adding && (
        <AddDialog
          clientId={clientId}
          existingMonths={new Set(entries.map((e) => e.plan_month))}
          onClose={() => setAdding(false)}
          onAdded={() => { setAdding(false); load() }}
        />
      )}
    </div>
  )
}

function AddDialog({
  clientId, existingMonths, onClose, onAdded,
}: {
  clientId: string
  existingMonths: Set<string>
  onClose: () => void
  onAdded: () => void
}) {
  const [month, setMonth] = useState(thisMonth)
  const [type, setType] = useState<MonthClientType>('new')
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!month) { setError('Kies een maand'); return }
    if (existingMonths.has(month)) { setError('Klant staat al in deze maand'); return }
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
          <h3 className="font-semibold">Maandplanning toevoegen</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Maand</label>
            <input type="month" className={inp} value={month} onChange={(e) => setMonth(e.target.value)} />
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
