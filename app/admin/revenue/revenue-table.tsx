'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2, Loader2, Repeat2, ArrowUpRight, Pencil, X, Search, Filter as FilterIcon } from 'lucide-react'
import { toast } from 'sonner'
import { formatEuro, SERVICE_LABELS, SERVICE_SLUGS } from '@/lib/utils'

interface EntryRow {
  id: string
  title: string | null
  client_id: string | null
  company_name: string
  service_slug: string | null
  type: 'recurring' | 'one_time'
  billing_frequency: string | null
  amount_per_month: number | null
  start_month: string | null
  end_month: string | null
  amount: number | null
  transaction_month: string | null
  notes: string | null
}

interface ClientOpt { id: string; company_name: string }
const monthInput = (s: string | null) => (s ? s.slice(0, 7) : '')

const FREQ_SUFFIX: Record<string, string> = {
  monthly: '/m', quarterly: '/kwartaal', 'semi-annual': '/half jaar', annual: '/jaar',
}

function fmtMonth(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' })
}

function entryYear(e: EntryRow): string {
  const m = e.type === 'recurring' ? e.start_month : e.transaction_month
  return m ? m.slice(0, 4) : ''
}

export function RevenueTable({ entries }: { entries: EntryRow[] }) {
  const router = useRouter()
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editing, setEditing] = useState<EntryRow | null>(null)

  // ── Filters ────────────────────────────────────────────────────────────────
  const [query, setQuery] = useState('')
  const [dq, setDq] = useState('')
  const [fType, setFType] = useState<string>('all')      // all | recurring | one_time
  const [fService, setFService] = useState<string>('all')
  const [fYear, setFYear] = useState<string>('all')
  const [minAmount, setMinAmount] = useState<string>('')
  const [maxAmount, setMaxAmount] = useState<string>('')

  useEffect(() => {
    try {
      const raw = localStorage.getItem('ngm.prognoseFilters')
      if (raw) {
        const s = JSON.parse(raw)
        setFType(s.fType ?? 'all'); setFService(s.fService ?? 'all'); setFYear(s.fYear ?? 'all')
        setMinAmount(s.minAmount ?? ''); setMaxAmount(s.maxAmount ?? '')
      }
    } catch { /* negeer */ }
  }, [])
  useEffect(() => {
    try { localStorage.setItem('ngm.prognoseFilters', JSON.stringify({ fType, fService, fYear, minAmount, maxAmount })) } catch { /* negeer */ }
  }, [fType, fService, fYear, minAmount, maxAmount])
  useEffect(() => { const t = setTimeout(() => setDq(query), 200); return () => clearTimeout(t) }, [query])

  const years = useMemo(() => Array.from(new Set(entries.map(entryYear).filter(Boolean))).sort().reverse(), [entries])
  const amountOf = (e: EntryRow) => (e.type === 'recurring' ? e.amount_per_month : e.amount) ?? 0

  const shown = useMemo(() => {
    const q = dq.trim().toLowerCase()
    const min = minAmount ? Number(minAmount) : null
    const max = maxAmount ? Number(maxAmount) : null
    return entries.filter((e) => {
      if (fType !== 'all' && e.type !== fType) return false
      if (fService !== 'all' && (e.service_slug ?? '') !== fService) return false
      if (fYear !== 'all' && entryYear(e) !== fYear) return false
      const amt = amountOf(e)
      if (min !== null && amt < min) return false
      if (max !== null && amt > max) return false
      if (q) {
        const hay = [e.title, e.company_name, e.notes, e.service_slug ? SERVICE_LABELS[e.service_slug] : ''].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, dq, fType, fService, fYear, minAmount, maxAmount])

  const hasFilters = query.trim() !== '' || fType !== 'all' || fService !== 'all' || fYear !== 'all' || minAmount !== '' || maxAmount !== ''
  const clearFilters = () => { setQuery(''); setFType('all'); setFService('all'); setFYear('all'); setMinAmount(''); setMaxAmount('') }
  const fsel = 'px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#fff848]/50'

  const handleDelete = async (id: string) => {
    if (!confirm('Deze omzet-entry verwijderen?')) return
    setDeletingId(id)
    try {
      await fetch('/api/admin/revenue', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      })
      router.refresh()
    } finally {
      setDeletingId(null)
    }
  }

  if (entries.length === 0) return null

  return (
    <div className="card-base">
      <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
        <h2 className="font-semibold">Alle entries <span className="text-sm font-normal text-gray-400">({shown.length}/{entries.length})</span></h2>
        {hasFilters && (
          <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-black flex items-center gap-1"><X className="h-3 w-3" />Reset</button>
        )}
      </div>

      {/* Filterbalk */}
      <div className="space-y-2 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Zoek op klant, titel, dienst, notitie…" className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50" />
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <FilterIcon className="h-4 w-4 text-gray-400" />
          <select className={fsel} value={fType} onChange={(e) => setFType(e.target.value)}>
            <option value="all">Alle types</option>
            <option value="recurring">Recurring</option>
            <option value="one_time">Eenmalig</option>
          </select>
          <select className={fsel} value={fService} onChange={(e) => setFService(e.target.value)}>
            <option value="all">Alle diensten</option>
            {SERVICE_SLUGS.map((s) => <option key={s} value={s}>{SERVICE_LABELS[s]}</option>)}
          </select>
          <select className={fsel} value={fYear} onChange={(e) => setFYear(e.target.value)}>
            <option value="all">Alle jaren</option>
            {years.map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
          <input type="number" min="0" placeholder="€ min" className={`${fsel} w-24`} value={minAmount} onChange={(e) => setMinAmount(e.target.value)} />
          <input type="number" min="0" placeholder="€ max" className={`${fsel} w-24`} value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="text-left py-2 text-xs text-gray-500 font-medium">Type</th>
              <th className="text-left py-2 text-xs text-gray-500 font-medium">Titel</th>
              <th className="text-left py-2 text-xs text-gray-500 font-medium">Klant</th>
              <th className="text-left py-2 text-xs text-gray-500 font-medium">Dienst</th>
              <th className="text-left py-2 text-xs text-gray-500 font-medium">Periode</th>
              <th className="text-right py-2 text-xs text-gray-500 font-medium">Bedrag</th>
              <th className="py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {shown.map((e) => (
              <tr key={e.id} className="hover:bg-gray-50">
                <td className="py-2.5">
                  {e.type === 'recurring' ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-green-100 text-green-700 rounded-full">
                      <Repeat2 className="h-3 w-3" />
                      Recurring
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">
                      <ArrowUpRight className="h-3 w-3" />
                      Eenmalig
                    </span>
                  )}
                </td>
                <td className="py-2.5 font-medium max-w-[180px] truncate">
                  {e.title || '—'}
                  {e.notes && <div className="text-xs text-gray-400 truncate">{e.notes}</div>}
                </td>
                <td className="py-2.5 text-gray-700">{e.company_name}</td>
                <td className="py-2.5 text-gray-500">
                  {e.service_slug ? (SERVICE_LABELS[e.service_slug] ?? e.service_slug) : '—'}
                </td>
                <td className="py-2.5 text-gray-500 text-xs">
                  {e.type === 'recurring' ? (
                    <span>
                      {fmtMonth(e.start_month)}
                      {e.end_month ? ` → ${fmtMonth(e.end_month)}` : ' (doorlopend)'}
                    </span>
                  ) : (
                    fmtMonth(e.transaction_month)
                  )}
                </td>
                <td className="py-2.5 text-right font-semibold">
                  {e.type === 'recurring' ? (
                    <span>
                      {formatEuro(e.amount_per_month)}
                      <span className="text-xs text-gray-400 font-normal">
                        {FREQ_SUFFIX[e.billing_frequency ?? 'monthly'] ?? '/m'}
                      </span>
                    </span>
                  ) : formatEuro(e.amount)}
                </td>
                <td className="py-2.5 text-right whitespace-nowrap">
                  <button
                    onClick={() => setEditing(e)}
                    className="p-1.5 text-gray-400 hover:text-gray-700 rounded-lg hover:bg-gray-100 transition-colors mr-1"
                    title="Bewerken"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(e.id)}
                    disabled={deletingId === e.id}
                    className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors"
                  >
                    {deletingId === e.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <EditDialog entry={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); router.refresh() }} />}
    </div>
  )
}

function EditDialog({ entry, onClose, onSaved }: { entry: EntryRow; onClose: () => void; onSaved: () => void }) {
  const [clients, setClients] = useState<ClientOpt[]>([])
  const [form, setForm] = useState({
    client_id: entry.client_id ?? '',
    title: entry.title ?? '',
    service_slug: entry.service_slug ?? '',
    amount_per_month: entry.amount_per_month != null ? String(entry.amount_per_month) : '',
    start_month: monthInput(entry.start_month),
    end_month: monthInput(entry.end_month),
    amount: entry.amount != null ? String(entry.amount) : '',
    transaction_month: monthInput(entry.transaction_month),
    notes: entry.notes ?? '',
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { fetch('/api/admin/clients-list').then((r) => r.json()).then((j) => setClients(j.clients ?? [])).catch(() => {}) }, [])

  const submit = async () => {
    if (!form.client_id) { setError('Selecteer een klant voor deze prognose.'); return }
    setLoading(true); setError(null)
    try {
      const body: Record<string, unknown> = {
        id: entry.id, client_id: form.client_id, title: form.title || null, service_slug: form.service_slug || null, notes: form.notes || null,
      }
      if (entry.type === 'recurring') {
        body.amount_per_month = form.amount_per_month ? Number(form.amount_per_month) : null
        body.start_month = form.start_month ? `${form.start_month}-01` : null
        body.end_month = form.end_month ? `${form.end_month}-01` : null
      } else {
        body.amount = form.amount ? Number(form.amount) : null
        body.transaction_month = form.transaction_month ? `${form.transaction_month}-01` : null
      }
      const res = await fetch('/api/admin/revenue', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('Prognose bijgewerkt.'); onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout') } finally { setLoading(false) }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold">Prognose bewerken</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><label className={lbl}>Klant *</label>
            <select className={inp} value={form.client_id} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}>
              <option value="">— Selecteer klant —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          <div><label className={lbl}>Titel</label><input className={inp} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} /></div>
          <div><label className={lbl}>Dienst</label>
            <select className={inp} value={form.service_slug} onChange={(e) => setForm((f) => ({ ...f, service_slug: e.target.value }))}>
              <option value="">— Optioneel —</option>
              {SERVICE_SLUGS.map((s) => <option key={s} value={s}>{SERVICE_LABELS[s]}</option>)}
            </select>
          </div>
          {entry.type === 'recurring' ? (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Bedrag / maand (€)</label><input type="number" min="0" step="0.01" className={inp} value={form.amount_per_month} onChange={(e) => setForm((f) => ({ ...f, amount_per_month: e.target.value }))} /></div>
              <div><label className={lbl}>Startmaand</label><input type="month" className={inp} value={form.start_month} onChange={(e) => setForm((f) => ({ ...f, start_month: e.target.value }))} /></div>
              <div><label className={lbl}>Eindmaand (optioneel)</label><input type="month" className={inp} value={form.end_month} onChange={(e) => setForm((f) => ({ ...f, end_month: e.target.value }))} /></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div><label className={lbl}>Bedrag (€)</label><input type="number" min="0" step="0.01" className={inp} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} /></div>
              <div><label className={lbl}>Transactiemaand</label><input type="month" className={inp} value={form.transaction_month} onChange={(e) => setForm((f) => ({ ...f, transaction_month: e.target.value }))} /></div>
            </div>
          )}
          <div><label className={lbl}>Notitie</label><input className={inp} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button onClick={submit} disabled={loading} className="btn-primary flex-1 justify-center">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Opslaan</button>
            <button onClick={onClose} className="btn-secondary">Annuleer</button>
          </div>
        </div>
      </div>
    </div>
  )
}
