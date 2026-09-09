'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, LayoutTemplate, Loader2, Upload, Trash2, Sliders, Send, X, FileText } from 'lucide-react'
import { toast } from 'sonner'
import { TEMPLATE_CATEGORIES } from '@/lib/contract-status'
import { fileTooBig, MAX_UPLOAD_MB, readJson } from '@/lib/upload'

type Template = {
  id: string; name: string; category: string | null; active: boolean
  pdf_path: string | null; field_count: number; created_at: string
}
type Client = { id: string; company_name: string }

const SERVICES = [
  { slug: '', label: '— Geen koppeling —' },
  { slug: 'social-media', label: 'Social Media Management' },
  { slug: 'webdesign', label: 'Website' },
  { slug: 'foto-video', label: 'Foto & Videografie' },
  { slug: 'grafisch-ontwerp', label: 'Grafisch Ontwerp' },
  { slug: 'marketing-consultancy', label: 'Marketing Consultancy' },
  { slug: 'ads', label: 'Google Advertising' },
]

export function TemplatesClient({
  initialTemplates, clients,
}: { initialTemplates: Template[]; clients: Client[] }) {
  const router = useRouter()
  const [createOpen, setCreateOpen] = useState(false)
  const [useTpl, setUseTpl] = useState<Template | null>(null)

  const toggleActive = async (t: Template) => {
    try {
      const res = await fetch(`/api/admin/contract-templates/${t.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !t.active }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }

  const del = async (t: Template) => {
    if (!confirm(`Template "${t.name}" verwijderen? Bestaande contracten blijven ongewijzigd.`)) return
    try {
      const res = await fetch(`/api/admin/contract-templates/${t.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Template verwijderd')
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Tabs */}
      <div className="flex items-center gap-2">
        <Link href="/admin/contracts" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border bg-white text-gray-600 border-gray-200 hover:bg-gray-50">
          <FileText className="h-4 w-4" />Contracten
        </Link>
        <Link href="/admin/contracts/templates" className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border bg-gray-900 text-white border-gray-900">
          <LayoutTemplate className="h-4 w-4" />Templates
        </Link>
      </div>

      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Contracttemplates</h1>
          <p className="text-sm text-gray-500 mt-0.5">{initialTemplates.length} template(s) — herbruikbare basiscontracten</p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="btn-primary shrink-0">
          <Plus className="h-4 w-4" />Nieuwe template
        </button>
      </div>

      {initialTemplates.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl text-center py-16 text-gray-400">
          <LayoutTemplate className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nog geen templates</p>
          <button onClick={() => setCreateOpen(true)} className="btn-primary mt-4 inline-flex">
            <Plus className="h-4 w-4" />Eerste template aanmaken
          </button>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {initialTemplates.map((t) => (
            <div key={t.id} className="card-base space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold truncate">{t.name}</h3>
                  {t.category && <p className="text-xs text-gray-500 mt-0.5">{t.category}</p>}
                </div>
                <span className={`status-badge shrink-0 ${t.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                  {t.active ? 'Actief' : 'Inactief'}
                </span>
              </div>
              <div className="flex items-center gap-3 text-xs text-gray-400">
                <span>{t.field_count} veld(en)</span>
                <span>{t.pdf_path ? 'PDF ✓' : 'Geen PDF'}</span>
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <button onClick={() => setUseTpl(t)} disabled={!t.pdf_path} className="btn-primary text-xs flex-1 justify-center disabled:opacity-40">
                  <Send className="h-3.5 w-3.5" />Nieuw contract
                </button>
                <Link href={`/admin/contracts/templates/${t.id}`} className="btn-secondary text-xs">
                  <Sliders className="h-3.5 w-3.5" />Velden
                </Link>
              </div>
              <div className="flex items-center justify-between pt-1 border-t border-gray-100">
                <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
                  <input type="checkbox" checked={t.active} onChange={() => toggleActive(t)} />
                  Actief
                </label>
                <button onClick={() => del(t)} className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                  <Trash2 className="h-3.5 w-3.5" />Verwijderen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {createOpen && <CreateDialog onClose={() => setCreateOpen(false)} onDone={() => { setCreateOpen(false); router.refresh() }} />}
      {useTpl && <FromTemplateDialog template={useTpl} clients={clients} onClose={() => setUseTpl(null)} />}
    </div>
  )
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState('')
  const [category, setCategory] = useState<string>(TEMPLATE_CATEGORIES[0])
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) { setError('Naam is verplicht'); return }
    if (file && fileTooBig(file)) { setError(`PDF te groot — max ${MAX_UPLOAD_MB} MB.`); return }
    setLoading(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('name', name)
      fd.append('category', category)
      if (file) fd.append('pdf', file)
      const res = await fetch('/api/admin/contract-templates', { method: 'POST', body: fd })
      const json = await readJson(res)
      toast.success('Template aangemaakt')
      // Direct door naar veldbewerking als er een PDF is.
      if (file && json.id) { window.location.href = `/admin/contracts/templates/${json.id}` }
      else onDone()
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout'); setLoading(false) }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  return (
    <Modal title="Nieuwe template" onClose={onClose}>
      <div className="space-y-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Naam *</label>
          <input className={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="Social Media pakket 1 — standaard" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Categorie</label>
          <select className={inp} value={category} onChange={(e) => setCategory(e.target.value)}>
            {TEMPLATE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">PDF</label>
          <label className="flex flex-col items-center justify-center gap-2 p-5 border-2 border-dashed border-gray-200 rounded-xl cursor-pointer hover:border-[#fff848]">
            <Upload className="h-5 w-5 text-gray-400" />
            <span className="text-sm text-gray-500">{file ? file.name : 'Klik om PDF te selecteren'}</span>
            <input type="file" accept=".pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          <p className="text-[11px] text-gray-400 mt-1">Na uploaden ga je naar AI-analyse om velden te detecteren.</p>
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex gap-2 pt-1">
          <button onClick={submit} disabled={loading} className="btn-primary flex-1 justify-center">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Aanmaken
          </button>
          <button onClick={onClose} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </Modal>
  )
}

function FromTemplateDialog({ template, clients, onClose }: { template: Template; clients: Client[]; onClose: () => void }) {
  const [clientId, setClientId] = useState('')
  const [service, setService] = useState('')
  const [signerName, setSignerName] = useState('')
  const [signerEmail, setSignerEmail] = useState('')
  const [title, setTitle] = useState(template.name)
  const [expiresAt, setExpiresAt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/admin/contracts/from-template', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          template_id: template.id,
          client_id: clientId || null,
          service_slug: service || null,
          signer_name: signerName || null,
          signer_email: signerEmail || null,
          title: title || null,
          expires_at: expiresAt || null,
        }),
      })
      const json = await readJson(res)
      window.location.href = `/admin/contracts/${json.id}`
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout'); setLoading(false) }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'
  return (
    <Modal title="Nieuw contract uit template" onClose={onClose}>
      <div className="space-y-3">
        <p className="text-xs text-gray-500">Op basis van <b>{template.name}</b>. PDF, velden en handtekeningzone worden overgenomen — je kan ze daarna nog aanpassen.</p>
        <div>
          <label className={lbl}>Contracttitel</label>
          <input className={inp} value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <label className={lbl}>Klant (optioneel)</label>
          <select className={inp} value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">— Geen klant (los/intern) —</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
          </select>
        </div>
        <div>
          <label className={lbl}>Dienst (optioneel)</label>
          <select className={inp} value={service} onChange={(e) => setService(e.target.value)}>
            {SERVICES.map((s) => <option key={s.slug} value={s.slug}>{s.label}</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className={lbl}>Ontvangernaam</label>
            <input className={inp} value={signerName} onChange={(e) => setSignerName(e.target.value)} placeholder="Jan Janssen" />
          </div>
          <div>
            <label className={lbl}>Ontvanger e-mail</label>
            <input type="email" className={inp} value={signerEmail} onChange={(e) => setSignerEmail(e.target.value)} placeholder="jan@bedrijf.be" />
          </div>
        </div>
        <div>
          <label className={lbl}>Vervaldatum tekenlink (optioneel)</label>
          <input type="date" className={inp} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </div>
        {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
        <div className="flex gap-2 pt-1">
          <button onClick={submit} disabled={loading} className="btn-primary flex-1 justify-center">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Contract aanmaken
          </button>
          <button onClick={onClose} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </Modal>
  )
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold">{title}</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}
