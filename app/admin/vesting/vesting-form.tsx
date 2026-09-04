'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2 } from 'lucide-react'
import { SERVICE_LABELS, SERVICE_SLUGS } from '@/lib/utils'
import { attributionFor } from '@/lib/vesting'

const euro = (n: number) => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)

export function VestingForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clients, setClients] = useState<string[]>([])

  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ client_name: '', service_slug: '', entry_date: today, net_revenue: '', type: 'outbound', outreach: false, closing: false })

  useEffect(() => {
    if (open && clients.length === 0) {
      fetch('/api/admin/clients-list').then(r => r.json()).then(j => setClients((j.clients ?? []).map((c: { company_name: string }) => c.company_name))).catch(() => {})
    }
  }, [open, clients.length])

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  const net = parseFloat(form.net_revenue) || 0
  const attribution = attributionFor(form.type, { outreach: form.outreach, closing: form.closing })
  const vesting = net * attribution / 100

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (net <= 0) { setError('Geef een netto omzet op'); return }
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/admin/vesting', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_name: form.client_name, service_slug: form.service_slug, entry_date: form.entry_date,
          net_revenue: net, type: form.type,
          outreach: form.type === 'outbound' ? form.outreach : false,
          closing: form.closing,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setOpen(false)
      setForm({ client_name: '', service_slug: '', entry_date: today, net_revenue: '', type: 'outbound', outreach: false, closing: false })
      router.refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Fout') } finally { setLoading(false) }
  }

  const YesNo = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
    <div>
      <label className={lbl}>{label}</label>
      <div className="grid grid-cols-2 gap-1.5">
        {[{ v: true, l: 'Ja' }, { v: false, l: 'Nee' }].map(o => (
          <button key={o.l} type="button" onClick={() => onChange(o.v)}
            className={`py-2 rounded-lg border text-sm font-medium transition-colors ${value === o.v ? 'border-[#fff848] bg-[#fff848]/10 text-black' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>{o.l}</button>
        ))}
      </div>
    </div>
  )

  if (!open) return <button onClick={() => setOpen(true)} className="btn-primary"><Plus className="h-4 w-4" />Vestigingsomzet toevoegen</button>

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="font-semibold">Vestigingsomzet registreren</h3>
          <button onClick={() => setOpen(false)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Klant</label>
              <input className={inp} list="vesting-clients" value={form.client_name} onChange={e => setForm(p => ({ ...p, client_name: e.target.value }))} placeholder="Klant of prospect" />
              <datalist id="vesting-clients">{clients.map(c => <option key={c} value={c} />)}</datalist>
            </div>
            <div>
              <label className={lbl}>Dienst</label>
              <select className={inp} value={form.service_slug} onChange={e => setForm(p => ({ ...p, service_slug: e.target.value }))}>
                <option value="">—</option>
                {SERVICE_SLUGS.map(s => <option key={s} value={s}>{SERVICE_LABELS[s]}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Datum</label>
              <input type="date" className={inp} value={form.entry_date} onChange={e => setForm(p => ({ ...p, entry_date: e.target.value }))} />
            </div>
            <div>
              <label className={lbl}>Netto omzet (€) *</label>
              <input required type="number" min="0" step="0.01" className={inp} value={form.net_revenue} onChange={e => setForm(p => ({ ...p, net_revenue: e.target.value }))} placeholder="10000" />
            </div>
          </div>

          <div>
            <label className={lbl}>Type</label>
            <div className="grid grid-cols-2 gap-1.5">
              {[{ v: 'outbound', l: 'Outbound' }, { v: 'inbound', l: 'Inbound' }].map(t => (
                <button key={t.v} type="button" onClick={() => setForm(p => ({ ...p, type: t.v, outreach: false, closing: false }))}
                  className={`py-2 rounded-lg border text-sm font-medium transition-colors ${form.type === t.v ? 'border-[#fff848] bg-[#fff848]/10 text-black' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}>{t.l}</button>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1">{form.type === 'outbound' ? 'Marco genereerde zelf de lead.' : 'De lead kwam spontaan binnen.'}</p>
          </div>

          {form.type === 'outbound' ? (
            <div className="grid grid-cols-2 gap-3">
              <YesNo label="Outreach (50%)" value={form.outreach} onChange={v => setForm(p => ({ ...p, outreach: v }))} />
              <YesNo label="Closing (50%)" value={form.closing} onChange={v => setForm(p => ({ ...p, closing: v }))} />
            </div>
          ) : (
            <YesNo label="Closing (25%)" value={form.closing} onChange={v => setForm(p => ({ ...p, closing: v }))} />
          )}

          <div className="bg-gray-50 border border-gray-100 rounded-lg px-3 py-2.5 text-sm grid grid-cols-3 gap-2 text-center">
            <div><div className="text-[11px] text-gray-500">Omzet</div><div className="font-semibold">{euro(net)}</div></div>
            <div><div className="text-[11px] text-gray-500">Toerekening</div><div className="font-semibold">{attribution}%</div></div>
            <div><div className="text-[11px] text-gray-500">Vestigingsomzet</div><div className="font-bold text-green-600">{euro(vesting)}</div></div>
          </div>

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading && <Loader2 className="h-4 w-4 animate-spin" />}Registreren</button>
            <button type="button" onClick={() => setOpen(false)} className="btn-secondary">Annuleer</button>
          </div>
        </form>
      </div>
    </div>
  )
}
