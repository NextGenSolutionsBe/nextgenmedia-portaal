'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Lightbulb, Send, Loader2, Paperclip, Plus, Trash2 } from 'lucide-react'
import { readJson, fileTooBig, MAX_UPLOAD_MB } from '@/lib/upload'

export type Idea = { id: string; title: string | null; description: string | null; attachment_url?: string | null; status: string; created_at: string }

const STATUS_LABEL: Record<string, string> = { new: 'Nieuw', seen: 'Bekeken', use: 'Wordt meegenomen', discard: 'Niet gebruikt' }
const STATUS_CLS: Record<string, string> = { new: 'bg-blue-100 text-blue-700', seen: 'bg-gray-100 text-gray-600', use: 'bg-green-100 text-green-700', discard: 'bg-gray-100 text-gray-600' }

export function ShootIdeas({ shootId, initialIdeas }: { shootId: string; initialIdeas: Idea[] }) {
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)

  const remove = async (id: string) => {
    if (!confirm('Dit idee verwijderen?')) return
    setDeleting(id)
    try {
      const res = await fetch(`/api/portal/shoot-ideas?id=${id}`, { method: 'DELETE' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      router.refresh()
    } catch (e) { alert(e instanceof Error ? e.message : 'Fout') } finally { setDeleting(null) }
  }

  const submit = async () => {
    if (!title.trim() && !desc.trim()) { setError('Geef een titel of omschrijving'); return }
    if (fileTooBig(file)) { setError(`Bijlage te groot — max ${MAX_UPLOAD_MB} MB.`); return }
    setLoading(true); setError(null)
    try {
      const fd = new FormData()
      fd.append('shoot_id', shootId); fd.append('title', title); fd.append('description', desc)
      if (file) fd.append('attachment', file)
      const res = await fetch('/api/portal/shoot-ideas', { method: 'POST', body: fd })
      await readJson(res)
      setTitle(''); setDesc(''); setFile(null); setAdding(false); router.refresh()
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout') } finally { setLoading(false) }
  }

  return (
    <div className="border-t border-gray-100 pt-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs text-gray-500"><Lightbulb className="h-3.5 w-3.5" />Jouw ideeën voor deze shoot</div>
        {!adding && <button onClick={() => setAdding(true)} className="text-xs text-gray-500 hover:text-black inline-flex items-center gap-1"><Plus className="h-3.5 w-3.5" />Idee toevoegen</button>}
      </div>

      {initialIdeas.length > 0 && (
        <div className="space-y-2">
          {initialIdeas.map(i => (
            <div key={i.id} className="text-sm rounded-lg px-3 py-2 border border-gray-100 bg-gray-50/60">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{i.title || 'Idee'}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_CLS[i.status] ?? 'bg-gray-100 text-gray-600'}`}>{STATUS_LABEL[i.status] ?? i.status}</span>
                  <button onClick={() => remove(i.id)} disabled={deleting === i.id} className="text-gray-300 hover:text-red-500" title="Verwijderen">
                    {deleting === i.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </button>
                </div>
              </div>
              {i.description && <p className="text-gray-600 mt-0.5 whitespace-pre-wrap">{i.description}</p>}
              {i.attachment_url && <a href={i.attachment_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-1"><Paperclip className="h-3 w-3" />Bijlage</a>}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="space-y-2 bg-white border border-gray-100 rounded-lg p-3">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="Titel (bv. Chique auto beschikbaar)" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
          <textarea rows={2} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Omschrijving / inspiratie…" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
          <input type="file" className="text-xs" onChange={e => setFile(e.target.files?.[0] ?? null)} />
          {error && <div className="text-xs text-red-600">{error}</div>}
          <div className="flex gap-2">
            <button onClick={submit} disabled={loading} className="btn-primary text-sm">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Versturen</button>
            <button onClick={() => { setAdding(false); setError(null) }} className="btn-secondary text-sm">Annuleer</button>
          </div>
        </div>
      )}
    </div>
  )
}
