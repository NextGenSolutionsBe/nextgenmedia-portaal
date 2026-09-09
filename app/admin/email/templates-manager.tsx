'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, X, Loader2, Pencil, Trash2, Sparkles, FileText } from 'lucide-react'
import { PLACEHOLDERS } from '@/lib/email-render'

type Template = { id: string; name: string; subject: string; body: string; kind: string | null; cta_text: string | null; cta_link: string | null }

export function TemplatesManager() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Template | null>(null)
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/email/templates')
      const j = await res.json()
      if (res.ok) setTemplates((j.templates ?? []) as Template[])
    } catch { /* stil */ } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const seedDefaults = async () => {
    setBusy('seed')
    try {
      await fetch('/api/admin/email/templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'seed_defaults' }) })
      await load()
    } finally { setBusy(null) }
  }

  const remove = async (id: string) => {
    if (!confirm('Template verwijderen?')) return
    setBusy(id)
    try {
      await fetch(`/api/admin/email/templates?id=${id}`, { method: 'DELETE' })
      setTemplates((t) => t.filter((x) => x.id !== id))
    } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-sm text-gray-500">Maak eenvoudige templates met placeholders. Geen technische kennis nodig.</p>
        <div className="flex gap-2">
          <button onClick={seedDefaults} disabled={busy === 'seed'} className="btn-secondary text-sm">{busy === 'seed' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Standaardtemplates</button>
          <button onClick={() => setCreating(true)} className="btn-primary text-sm"><Plus className="h-4 w-4" />Nieuwe template</button>
        </div>
      </div>

      <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3">
        <div className="text-xs font-medium text-gray-500 mb-2">Beschikbare placeholders (kopieer in onderwerp of inhoud)</div>
        <div className="flex flex-wrap gap-1.5">
          {PLACEHOLDERS.map((p) => <code key={p} className="text-[11px] bg-white border border-gray-200 rounded px-1.5 py-0.5">{p}</code>)}
        </div>
      </div>

      {loading ? (
        <div className="card-base text-center text-gray-400 py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : templates.length === 0 ? (
        <div className="card-base text-center text-gray-400 py-10">
          <FileText className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nog geen templates. Klik "Standaardtemplates" om de voorbeelden toe te voegen.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {templates.map((t) => (
            <div key={t.id} className="card-base">
              <div className="flex items-start justify-between gap-2 mb-1">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{t.name}</div>
                  <div className="text-xs text-gray-500 truncate">{t.subject}</div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => setEditing(t)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400" title="Bewerken"><Pencil className="h-3.5 w-3.5" /></button>
                  <button onClick={() => remove(t.id)} disabled={busy === t.id} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400" title="Verwijderen">{busy === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>
                </div>
              </div>
              <p className="text-xs text-gray-400 whitespace-pre-wrap line-clamp-4">{t.body}</p>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <TemplateDialog
          template={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); load() }}
        />
      )}
    </div>
  )
}

function TemplateDialog({ template, onClose, onSaved }: { template: Template | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!template
  const [name, setName] = useState(template?.name ?? '')
  const [subject, setSubject] = useState(template?.subject ?? '')
  const [body, setBody] = useState(template?.body ?? '')
  const [ctaText, setCtaText] = useState(template?.cta_text ?? '')
  const [ctaLink, setCtaLink] = useState(template?.cta_link ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!name.trim()) { setError('Naam is verplicht'); return }
    setLoading(true); setError(null)
    try {
      const payload = { name, subject, body, cta_text: ctaText || null, cta_link: ctaLink || null }
      const res = await fetch('/api/admin/email/templates', {
        method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { id: template!.id, ...payload } : payload),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout') } finally { setLoading(false) }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold">{isEdit ? 'Template bewerken' : 'Nieuwe template'}</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Naam template</label>
            <input className={inp} value={name} onChange={(e) => setName(e.target.value)} placeholder="Bv. Nieuwe scripts klaar" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Onderwerp</label>
            <input className={inp} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Nieuwe scripts klaar om te bekijken" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Inhoud</label>
            <textarea rows={10} className={inp} value={body} onChange={(e) => setBody(e.target.value)} placeholder={'Hallo {{klantnaam}},\n\n…'} />
          </div>
          <div className="flex flex-wrap gap-1">
            {PLACEHOLDERS.map((p) => (
              <button key={p} type="button" onClick={() => setBody((b) => b + p)} className="text-[11px] bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5 hover:bg-gray-100">{p}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-gray-100 pt-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">CTA-knop tekst</label>
              <input className={inp} value={ctaText} onChange={(e) => setCtaText(e.target.value)} placeholder="Bv. Contract bekijken" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">CTA-knop link</label>
              <input className={inp} value={ctaLink} onChange={(e) => setCtaLink(e.target.value)} placeholder="{{contract_link}}" />
            </div>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button onClick={submit} disabled={loading} className="btn-primary flex-1 justify-center">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{isEdit ? 'Opslaan' : 'Aanmaken'}</button>
            <button onClick={onClose} className="btn-secondary">Annuleer</button>
          </div>
        </div>
      </div>
    </div>
  )
}
