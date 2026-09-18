'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X, Plus, Check } from 'lucide-react'
import { readJson, fileTooBig, MAX_UPLOAD_MB } from '@/lib/upload'

export function PartnerPaymentForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ direction: 'partner_pays_us', amount: '', paid_on: today, note: '' })
  const [proof, setProof] = useState<File | null>(null)

  const submit = async () => {
    if (!form.amount || parseFloat(form.amount) <= 0) { setError('Geef een geldig bedrag'); return }
    if (fileTooBig(proof)) { setError(`Bewijs te groot — max ${MAX_UPLOAD_MB} MB.`); return }
    setLoading(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('direction', form.direction); fd.append('amount', form.amount)
      fd.append('paid_on', form.paid_on); fd.append('note', form.note)
      if (proof) fd.append('proof', proof)
      const res = await fetch('/api/partner/payments', { method: 'POST', body: fd })
      await readJson(res)
      setOpen(false); setForm({ direction: 'partner_pays_us', amount: '', paid_on: today, note: '' }); setProof(null)
      router.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout') } finally { setLoading(false) }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  return (
    <>
      <button onClick={() => { setError(null); setOpen(true) }} className="btn-primary text-sm"><Plus className="h-4 w-4" />Betaling registreren</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div>
                <h3 className="font-semibold">Betaling registreren</h3>
                <p className="text-xs text-gray-500 mt-0.5">Wordt ter goedkeuring naar NextGenMedia gestuurd.</p>
              </div>
              <button onClick={() => setOpen(false)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-1 gap-2">
                {([['partner_pays_us', 'Ik heb NextGenMedia betaald'], ['we_pay_partner', 'NextGenMedia heeft mij betaald']] as const).map(([val, label]) => (
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
                <button onClick={submit} disabled={loading} className="btn-primary flex-1 justify-center">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Versturen</button>
                <button onClick={() => setOpen(false)} className="btn-secondary">Annuleer</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
