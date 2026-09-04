'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2 } from 'lucide-react'
import { readJson, fileTooBig, MAX_UPLOAD_MB } from '@/lib/upload'

const euro = (n: number) => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(n)
const CATEGORIES = ['Hardware', 'Software', 'Marketing', 'Materiaal', 'Reiskosten', 'Overige']
const THRESHOLD = 1000

export function PurchaseForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({ title: '', description: '', amount_excl: '', vat_pct: '21', supplier: '', category: 'Hardware', entry_date: today })
  const [file, setFile] = useState<File | null>(null)

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'
  const excl = parseFloat(form.amount_excl) || 0
  const incl = excl * (1 + (parseFloat(form.vat_pct) || 0) / 100)
  const needsApproval = incl > THRESHOLD

  const submit = async (concept: boolean, e: React.FormEvent) => {
    e.preventDefault()
    if (!form.title.trim()) { setError('Titel is verplicht'); return }
    if (excl <= 0) { setError('Bedrag is verplicht'); return }
    if (fileTooBig(file)) { setError(`Bijlage te groot — max ${MAX_UPLOAD_MB} MB.`); return }
    setLoading(true); setError(null)
    try {
      const fd = new FormData()
      Object.entries(form).forEach(([k, v]) => fd.append(k, v))
      fd.append('concept', String(concept))
      if (file) fd.append('attachment', file)
      const res = await fetch('/api/admin/purchases', { method: 'POST', body: fd })
      await readJson(res)
      setOpen(false)
      setForm({ title: '', description: '', amount_excl: '', vat_pct: '21', supplier: '', category: 'Hardware', entry_date: today }); setFile(null)
      router.refresh()
    } catch (err) { setError(err instanceof Error ? err.message : 'Fout') } finally { setLoading(false) }
  }

  if (!open) return <button onClick={() => setOpen(true)} className="btn-primary"><Plus className="h-4 w-4" />Aankoop aanvragen</button>

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white rounded-t-2xl">
          <h3 className="font-semibold">Aankoopaanvraag</h3>
          <button onClick={() => setOpen(false)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={(e) => submit(false, e)} className="p-5 space-y-4">
          <div><label className={lbl}>Titel *</label><input required className={inp} value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} placeholder="bv. MacBook Pro" /></div>
          <div><label className={lbl}>Omschrijving</label><textarea rows={2} className={inp} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className={lbl}>Bedrag excl. btw (€) *</label><input required type="number" min="0" step="0.01" className={inp} value={form.amount_excl} onChange={e => setForm(p => ({ ...p, amount_excl: e.target.value }))} placeholder="2300" /></div>
            <div><label className={lbl}>BTW %</label><input type="number" step="1" className={inp} value={form.vat_pct} onChange={e => setForm(p => ({ ...p, vat_pct: e.target.value }))} /></div>
            <div><label className={lbl}>Leverancier</label><input className={inp} value={form.supplier} onChange={e => setForm(p => ({ ...p, supplier: e.target.value }))} /></div>
            <div><label className={lbl}>Categorie</label><select className={inp} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
            <div><label className={lbl}>Datum</label><input type="date" className={inp} value={form.entry_date} onChange={e => setForm(p => ({ ...p, entry_date: e.target.value }))} /></div>
            <div><label className={lbl}>Bijlage (optioneel)</label><input type="file" className="text-xs w-full" onChange={e => setFile(e.target.files?.[0] ?? null)} /></div>
          </div>

          {excl > 0 && (
            <div className={`text-sm rounded-lg px-3 py-2.5 border ${needsApproval ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'}`}>
              Incl. btw: <span className="font-semibold">{euro(incl)}</span> ·{' '}
              {needsApproval ? <span className="text-amber-700">boven €{THRESHOLD} → goedkeuring door de twee andere zaakvoerders nodig</span>
                : <span className="text-green-700">onder €{THRESHOLD} → geen goedkeuring vereist</span>}
            </div>
          )}

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading && <Loader2 className="h-4 w-4 animate-spin" />}{needsApproval ? 'Indienen ter goedkeuring' : 'Registreren'}</button>
            <button type="button" onClick={(e) => submit(true, e)} disabled={loading} className="btn-secondary">Opslaan als concept</button>
          </div>
        </form>
      </div>
    </div>
  )
}
