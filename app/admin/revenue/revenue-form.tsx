'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2, Repeat2, ArrowUpRight } from 'lucide-react'
import { SERVICE_LABELS, SERVICE_SLUGS } from '@/lib/utils'

interface Client { id: string; company_name: string }

type EntryType = 'recurring' | 'one_time'
type BillingFreq = 'monthly' | 'quarterly' | 'semi-annual' | 'annual'

const FREQ_OPTIONS: { value: BillingFreq; label: string; suffix: string }[] = [
  { value: 'monthly',     label: 'Maandelijks',    suffix: '/maand'     },
  { value: 'quarterly',   label: 'Kwartaal',       suffix: '/kwartaal'  },
  { value: 'semi-annual', label: 'Halfjaarlijks',  suffix: '/half jaar' },
  { value: 'annual',      label: 'Jaarlijks',      suffix: '/jaar'      },
]

const MONTH_OPTIONS = () => {
  const now = new Date()
  const opts: { value: string; label: string }[] = []
  for (let i = -12; i <= 36; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1)
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
    const label = d.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' })
    opts.push({ value, label })
  }
  return opts
}

export function RevenueForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clients, setClients] = useState<Client[]>([])
  const [type, setType] = useState<EntryType>('recurring')
  const [endMode, setEndMode] = useState<'end_month' | 'months_count' | 'ongoing'>('months_count')

  const today = new Date()
  const thisMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`

  const [form, setForm] = useState({
    title: '',
    client_id: '',
    service_slug: '',
    billing_frequency: 'monthly' as BillingFreq,
    // recurring
    amount_per_month: '',
    start_month: thisMonth,
    end_month: '',
    months_count: '12',
    // one-time
    amount: '',
    transaction_month: thisMonth,
    notes: '',
  })

  const monthOptions = MONTH_OPTIONS()
  const freqSuffix = FREQ_OPTIONS.find(f => f.value === form.billing_frequency)?.suffix ?? '/maand'

  useEffect(() => {
    if (open && clients.length === 0) {
      fetch('/api/admin/clients-list')
        .then(r => r.json())
        .then(j => setClients(j.clients ?? []))
    }
  }, [open, clients.length])

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  const reset = () => {
    setForm({ title: '', client_id: '', service_slug: '', billing_frequency: 'monthly', amount_per_month: '', start_month: thisMonth, end_month: '', months_count: '12', amount: '', transaction_month: thisMonth, notes: '' })
    setEndMode('months_count')
    setType('recurring')
    setError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) { setError('Geef een titel op'); return }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/revenue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          client_id: form.client_id,
          service_slug: form.service_slug || null,
          type,
          billing_frequency: type === 'recurring' ? form.billing_frequency : 'monthly',
          amount_per_month: type === 'recurring' ? form.amount_per_month : undefined,
          start_month: type === 'recurring' ? form.start_month : undefined,
          end_month: (type === 'recurring' && endMode === 'end_month') ? form.end_month : undefined,
          months_count: (type === 'recurring' && endMode === 'months_count') ? form.months_count : undefined,
          amount: type === 'one_time' ? form.amount : undefined,
          transaction_month: type === 'one_time' ? form.transaction_month : undefined,
          notes: form.notes,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setOpen(false)
      reset()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout')
    } finally {
      setLoading(false)
    }
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn-primary">
        <Plus className="h-4 w-4" />
        Omzet toevoegen
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="font-semibold text-gray-900">Omzet toevoegen</h3>
          <button onClick={() => { setOpen(false); reset() }} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Type toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl">
            {(['recurring', 'one_time'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setType(t)}
                className={`flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors ${
                  type === t ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                {t === 'recurring' ? <Repeat2 className="h-4 w-4" /> : <ArrowUpRight className="h-4 w-4" />}
                {t === 'recurring' ? 'Recurring' : 'Eenmalig'}
              </button>
            ))}
          </div>

          {/* Title */}
          <div>
            <label className={lbl}>Titel *</label>
            <input
              required
              className={inp}
              value={form.title}
              onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
              placeholder="bijv. Social Media Retainer, Website Redesign..."
            />
          </div>

          {/* Client */}
          <div>
            <label className={lbl}>Klant *</label>
            <select required className={inp} value={form.client_id} onChange={e => setForm(p => ({ ...p, client_id: e.target.value }))}>
              <option value="">— Selecteer klant —</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>

          {/* Service */}
          <div>
            <label className={lbl}>Gekoppelde dienst</label>
            <select className={inp} value={form.service_slug} onChange={e => setForm(p => ({ ...p, service_slug: e.target.value }))}>
              <option value="">— Optioneel —</option>
              {SERVICE_SLUGS.map(s => <option key={s} value={s}>{SERVICE_LABELS[s]}</option>)}
            </select>
          </div>

          {type === 'recurring' ? (
            <>
              {/* Billing frequency */}
              <div>
                <label className={lbl}>Facturatiefrequentie</label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {FREQ_OPTIONS.map(f => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => setForm(p => ({ ...p, billing_frequency: f.value }))}
                      className={`py-2 rounded-lg border text-xs font-medium transition-colors ${
                        form.billing_frequency === f.value
                          ? 'border-[#fff848] bg-[#fff848]/10 text-black'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Amount */}
              <div>
                <label className={lbl}>Bedrag {freqSuffix} (€) *</label>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  className={inp}
                  value={form.amount_per_month}
                  onChange={e => setForm(p => ({ ...p, amount_per_month: e.target.value }))}
                  placeholder={form.billing_frequency === 'annual' ? '18000' : form.billing_frequency === 'semi-annual' ? '9000' : form.billing_frequency === 'quarterly' ? '4500' : '1500'}
                />
              </div>

              {/* Start month */}
              <div>
                <label className={lbl}>Startmaand eerste factuur *</label>
                <select required className={inp} value={form.start_month} onChange={e => setForm(p => ({ ...p, start_month: e.target.value }))}>
                  {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>

              {/* Duration */}
              <div>
                <label className={lbl}>Contractduur</label>
                <div className="flex gap-2 mb-2">
                  {[
                    { v: 'months_count', l: 'Aantal maanden' },
                    { v: 'end_month',    l: 'Einddatum' },
                    { v: 'ongoing',      l: 'Doorlopend' },
                  ].map(o => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setEndMode(o.v as typeof endMode)}
                      className={`flex-1 py-1.5 text-xs rounded-lg border transition-colors ${
                        endMode === o.v
                          ? 'border-[#fff848] bg-[#fff848]/10 text-black font-medium'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
                {endMode === 'months_count' && (
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min="1"
                      max="60"
                      step="1"
                      className="flex-1 accent-[#fff848]"
                      value={form.months_count}
                      onChange={e => setForm(p => ({ ...p, months_count: e.target.value }))}
                    />
                    <span className="text-sm font-bold w-20 text-right">{form.months_count} maanden</span>
                  </div>
                )}
                {endMode === 'end_month' && (
                  <select required className={inp} value={form.end_month} onChange={e => setForm(p => ({ ...p, end_month: e.target.value }))}>
                    <option value="">— Selecteer eindmaand —</option>
                    {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                )}
                {endMode === 'ongoing' && (
                  <p className="text-xs text-gray-400 mt-1">Recurring zonder einddatum — loopt tot manueel stopgezet.</p>
                )}
              </div>
            </>
          ) : (
            <>
              <div>
                <label className={lbl}>Bedrag (€) *</label>
                <input
                  required
                  type="number"
                  min="0"
                  step="0.01"
                  className={inp}
                  value={form.amount}
                  onChange={e => setForm(p => ({ ...p, amount: e.target.value }))}
                  placeholder="3500"
                />
              </div>
              <div>
                <label className={lbl}>Transactiemaand *</label>
                <select required className={inp} value={form.transaction_month} onChange={e => setForm(p => ({ ...p, transaction_month: e.target.value }))}>
                  {monthOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </>
          )}

          {/* Notes */}
          <div>
            <label className={lbl}>Notitie</label>
            <input className={inp} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optionele omschrijving..." />
          </div>

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              Toevoegen
            </button>
            <button type="button" onClick={() => { setOpen(false); reset() }} className="btn-secondary">Annuleer</button>
          </div>
        </form>
      </div>
    </div>
  )
}
