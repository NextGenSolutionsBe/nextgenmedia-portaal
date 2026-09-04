'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { ChevronLeft, Loader2, Upload } from 'lucide-react'
import { readJson, fileTooBig, MAX_UPLOAD_MB } from '@/lib/upload'
import { CONTRACT_TYPES, DURATION_TYPES } from '@/lib/contract-status'

export default function NewContractPage() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clients, setClients] = useState<Array<{ id: string; company_name: string }>>([])
  const [file, setFile] = useState<File | null>(null)
  const now = new Date()
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [form, setForm] = useState({
    client_id: '',
    title: '',
    contract_type: '',
    duration_type: '12m',
    service_slug: '',
    signer_name: '',
    signer_email: '',
    already_signed: false,
    signed_at: now.toISOString().slice(0, 10),
    start_month: thisMonth,
    duration_months: '12',
  })

  useEffect(() => {
    // cache: 'no-store' guarantees the freshest clients list (newly created/deleted clients show immediately)
    fetch('/api/admin/clients-list', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => setClients(j.clients ?? []))
      .catch(() => setClients([]))
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!file) { setError('Selecteer een PDF-bestand'); return }
    if (!form.contract_type) { setError('Contracttype is verplicht'); return }
    if (fileTooBig(file)) { setError(`PDF te groot — max ${MAX_UPLOAD_MB} MB. Comprimeer het bestand en probeer opnieuw.`); return }
    setLoading(true)
    setError(null)

    try {
      const fd = new FormData()
      fd.append('pdf', file)
      fd.append('client_id', form.client_id)
      fd.append('title', form.title)
      fd.append('contract_type', form.contract_type)
      fd.append('duration_type', form.duration_type)
      fd.append('service_slug', form.service_slug)
      fd.append('signer_name', form.signer_name)
      fd.append('signer_email', form.signer_email)
      fd.append('already_signed', String(form.already_signed))
      fd.append('start_month', form.start_month)
      fd.append('duration_months', form.duration_months)
      if (form.already_signed) fd.append('signed_at', form.signed_at)

      const res = await fetch('/api/admin/contracts', { method: 'POST', body: fd })
      const json = await readJson(res)
      // Hard redirect — guarantees the contracts list shows the new contract
      window.location.href = `/admin/contracts/${json.id as string}`
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout')
    } finally {
      setLoading(false)
    }
  }

  const inp = 'input-base'
  const lbl = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <div className="max-w-xl space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link href="/admin/contracts" className="btn-secondary px-2">
          <ChevronLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Nieuw contract</h1>
          <p className="text-sm text-gray-500">Upload een PDF-contract en koppel aan klant</p>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card-base space-y-4">
        <div>
          <label className={lbl}>Klant (optioneel)</label>
          <select className={inp} value={form.client_id} onChange={(e) => setForm((p) => ({ ...p, client_id: e.target.value }))}>
            <option value="">— Geen klant (los/intern contract) —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
          <p className="text-xs text-gray-400 mt-1">Zonder klant verschijnt het contract niet in een klantportaal — enkel intern + via de publieke tekenlink.</p>
        </div>
        <div>
          <label className={lbl}>Contracttitel *</label>
          <input required className={inp} value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Social Media Contract 2025" />
        </div>
        <div>
          <label className={lbl}>Contracttype *</label>
          <select required className={inp} value={form.contract_type} onChange={(e) => setForm((p) => ({ ...p, contract_type: e.target.value }))}>
            <option value="">— Selecteer type —</option>
            {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Dienst (voor portaaltoegang)</label>
          <select className={inp} value={form.service_slug} onChange={(e) => setForm((p) => ({ ...p, service_slug: e.target.value }))}>
            <option value="">— Geen koppeling —</option>
            <option value="social-media">Social Media Management</option>
            <option value="webdesign">Website</option>
            <option value="foto-video">Foto &amp; Videografie</option>
            <option value="grafisch-ontwerp">Grafisch Ontwerp</option>
            <option value="marketing-consultancy">Marketing Consultancy</option>
            <option value="ads">Google Advertising</option>
          </select>
          <p className="text-xs text-gray-400 mt-1">Als dit contract getekend wordt, kan de admin portaaltoegang verlenen voor deze dienst.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Naam ondertekenaar</label>
            <input className={inp} value={form.signer_name} onChange={(e) => setForm((p) => ({ ...p, signer_name: e.target.value }))} placeholder="Jan Janssen" />
          </div>
          <div>
            <label className={lbl}>E-mail ondertekenaar</label>
            <input type="email" className={inp} value={form.signer_email} onChange={(e) => setForm((p) => ({ ...p, signer_email: e.target.value }))} placeholder="jan@bedrijf.be" />
          </div>
        </div>

        {/* Contractduur */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={lbl}>Contractduur</label>
            <select className={inp} value={form.duration_type} onChange={(e) => setForm((p) => ({ ...p, duration_type: e.target.value }))}>
              {DURATION_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          {/* Startmaand enkel relevant als er een looptijd is (niet bij eenmalig) */}
          {form.duration_type !== 'eenmalig' && (
            <div>
              <label className={lbl}>Startmaand</label>
              <input type="month" className={inp} value={form.start_month} onChange={(e) => setForm((p) => ({ ...p, start_month: e.target.value }))} />
            </div>
          )}
          {/* Aangepast: optioneel aantal maanden */}
          {form.duration_type === 'aangepast' && (
            <div>
              <label className={lbl}>Aantal maanden (optioneel)</label>
              <input type="number" min="0" className={inp} value={form.duration_months} onChange={(e) => setForm((p) => ({ ...p, duration_months: e.target.value }))} placeholder="bv. 18" />
            </div>
          )}
        </div>

        {/* Reeds getekend toggle */}
        <div className="rounded-xl border border-gray-200 p-4 space-y-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.already_signed}
              onChange={(e) => setForm((p) => ({ ...p, already_signed: e.target.checked }))}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 accent-gray-900"
            />
            <div>
              <div className="text-sm font-medium text-gray-900">Dit contract is al getekend</div>
              <div className="text-xs text-gray-500 mt-0.5">
                Voor bestaande klanten die offline/eerder al tekenden. De PDF verschijnt meteen als getekend in hun portaal.
              </div>
            </div>
          </label>
          {form.already_signed && (
            <div>
              <label className={lbl}>Getekend op</label>
              <input type="date" className={inp} value={form.signed_at} onChange={(e) => setForm((p) => ({ ...p, signed_at: e.target.value }))} />
            </div>
          )}
        </div>
        <div>
          <label className={lbl}>PDF-contract *</label>
          <label className="flex flex-col items-center justify-center gap-2 p-6 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-[#fff848] transition-colors">
            <Upload className="h-6 w-6 text-gray-400" />
            <span className="text-sm text-gray-500">
              {file ? file.name : 'Klik om PDF te selecteren'}
            </span>
            <input
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
            {error}
          </div>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={loading} className="btn-primary">
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Contract aanmaken
          </button>
          <Link href="/admin/contracts" className="btn-secondary">Annuleren</Link>
        </div>
      </form>
    </div>
  )
}
