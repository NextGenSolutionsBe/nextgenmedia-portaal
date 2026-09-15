'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X, Check, Ban, Plus, Wallet, Clock } from 'lucide-react'
import { formatEuro, formatDate } from '@/lib/utils'
import { readJson, fileTooBig, MAX_UPLOAD_MB } from '@/lib/upload'

export type Payment = {
  id: string
  direction: string
  amount: number
  paid_on: string
  note: string | null
  status: string
  created_by_role: string | null
  created_at: string
}

const STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'In afwachting', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Goedgekeurd', cls: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Geannuleerd', cls: 'bg-gray-100 text-gray-600' },
}

export function PartnerPayments({ partnerId, payments }: { partnerId: string; payments: Payment[] }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ direction: 'we_pay_partner', amount: '', paid_on: today, note: '' })
  const [proof, setProof] = useState<File | null>(null)

  const register = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) { setError('Geef een geldig bedrag'); return }
    if (fileTooBig(proof)) { setError(`Bewijs te groot — max ${MAX_UPLOAD_MB} MB.`); return }
    setBusy('new'); setError(null)
    try {
      const fd = new FormData()
      fd.append('direction', form.direction); fd.append('amount', form.amount)
      fd.append('paid_on', form.paid_on); fd.append('note', form.note)
      if (proof) fd.append('proof', proof)
      const res = await fetch(`/api/admin/partners/${partnerId}/payments`, { method: 'POST', body: fd })
      await readJson(res)
      setOpen(false); setForm({ direction: 'we_pay_partner', amount: '', paid_on: today, note: '' }); setProof(null)
      router.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }

  const setStatus = async (payment_id: string, status: 'approved' | 'cancelled') => {
    setBusy(payment_id)
    try {
      const res = await fetch(`/api/admin/partners/${partnerId}/payments`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ payment_id, status }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      router.refresh()
    } catch (e) { alert(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  const pending = payments.filter((p) => p.status === 'pending')

  return (
    <div className="card-base">
      <div className="mb-4 flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="font-semibold flex items-center gap-2"><Wallet className="h-4 w-4 text-[#c5b800]" />Betalingen</h2>
          <p className="text-xs text-gray-500 mt-0.5">Geregistreerde betalingen vereffenen het saldo. Een betaling wordt nooit verwijderd — enkel goedgekeurd of geannuleerd.</p>
        </div>
        <button onClick={() => { setError(null); setOpen(true) }} className="btn-primary text-sm"><Plus className="h-4 w-4" />Betaling registreren</button>
      </div>

      {pending.length > 0 && (
        <div className="mb-3 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />{pending.length} betaling{pending.length === 1 ? '' : 'en'} in afwachting van goedkeuring
        </div>
      )}

      {payments.length === 0 ? (
        <p className="py-4 text-center text-sm text-gray-400">Nog geen betalingen geregistreerd.</p>
      ) : (
        <div className="space-y-2">
          {payments.map((p) => {
            const wePay = p.direction === 'we_pay_partner'
            const st = STATUS[p.status] ?? { label: p.status, cls: 'bg-gray-100 text-gray-600' }
            return (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2.5 flex-wrap">
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    <span className={wePay ? 'text-green-600' : 'text-red-600'}>{wePay ? 'Wij betalen partner' : 'Partner betaalt ons'}</span>
                    {' · '}{formatEuro(Math.abs(p.amount))}
                  </div>
                  <div className="text-xs text-gray-400">{formatDate(p.paid_on)} · {p.created_by_role === 'partner' ? 'door partner' : 'door admin'}{p.note ? ` · ${p.note}` : ''}</div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`status-badge text-xs ${st.cls}`}>{st.label}</span>
                  {p.status === 'pending' && (
                    <>
                      <button onClick={() => setStatus(p.id, 'approved')} disabled={busy === p.id} className="btn-secondary text-xs" title="Goedkeuren">
                        {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Goedkeuren
                      </button>
                      <button onClick={() => setStatus(p.id, 'cancelled')} disabled={busy === p.id} className="text-xs inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50" title="Afkeuren">
                        <Ban className="h-3.5 w-3.5" />Afkeuren
                      </button>
                    </>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold">Betaling registreren</h3>
              <button onClick={() => setOpen(false)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-1 gap-2">
                {([['we_pay_partner', 'Wij betalen partner'], ['partner_pays_us', 'Partner betaalt ons']] as const).map(([val, label]) => (
                  <button key={val} type="button" onClick={() => setForm((f) => ({ ...f, direction: val }))}
                    className={`text-left rounded-lg border p-3 text-sm transition-colors ${form.direction === val ? 'border-[#fff848] bg-[#fff848]/10 ring-1 ring-[#fff848]' : 'border-gray-200 hover:border-gray-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bedrag (€)</label>
                <input type="number" min="0" step="0.01" className={inp} value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} placeholder="500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Datum</label>
                <input type="date" className={inp} value={form.paid_on} onChange={(e) => setForm((f) => ({ ...f, paid_on: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Opmerking (optioneel)</label>
                <textarea rows={2} className={inp} value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Bewijs (optioneel)</label>
                <input type="file" className="text-xs" onChange={(e) => setProof(e.target.files?.[0] ?? null)} />
              </div>
              {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
              <div className="flex gap-2 pt-1">
                <button onClick={register} disabled={busy === 'new'} className="btn-primary flex-1 justify-center">{busy === 'new' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Registreren (goedgekeurd)</button>
                <button onClick={() => setOpen(false)} className="btn-secondary">Annuleer</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
