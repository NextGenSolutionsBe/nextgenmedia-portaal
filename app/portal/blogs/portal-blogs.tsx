'use client'

import { useState } from 'react'
import { Newspaper, Loader2, Save, X, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'

export type PortalBlog = {
  id: string
  titel: string
  slug: string
  content: string | null
  meta_title: string | null
  meta_description: string | null
  status: string
  gepubliceerd_op: string | null
  gegenereerd_op: string
  laatst_bewerkt_door: string | null
  laatst_bewerkt_op: string | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  klaar_voor_review: { label: 'In review', cls: 'bg-amber-100 text-amber-700' },
  goedgekeurd: { label: 'Goedgekeurd', cls: 'bg-blue-100 text-blue-700' },
  gepubliceerd: { label: 'Gepubliceerd', cls: 'bg-green-100 text-green-700' },
  gefaald: { label: 'Mislukt', cls: 'bg-red-100 text-red-700' },
}

export function PortalBlogs({ initialBlogs, canEdit = true }: { initialBlogs: PortalBlog[]; canEdit?: boolean }) {
  const router = useRouter()
  const [blogs, setBlogs] = useState(initialBlogs)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<PortalBlog>>({})
  const [saving, setSaving] = useState(false)

  const startEdit = (b: PortalBlog) => {
    setEditing(b.id)
    setForm({ titel: b.titel, content: b.content, meta_title: b.meta_title, meta_description: b.meta_description })
  }

  const save = async (id: string) => {
    setSaving(true)
    try {
      const res = await fetch('/api/portal/blogs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...form }) })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setBlogs((prev) => prev.map((b) => (b.id === id ? { ...b, ...form } as PortalBlog : b)))
      setEditing(null)
      if (j.pushed) toast.success('Opgeslagen en op je website bijgewerkt.')
      else if (j.pushError) toast.warning(`Opgeslagen, maar publiceren mislukte: ${j.pushError}`)
      else toast.success('Wijzigingen opgeslagen.')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukt')
    } finally {
      setSaving(false)
    }
  }

  if (blogs.length === 0) return <div className="card-base text-sm text-gray-500">Er zijn nog geen blogs aangemaakt.</div>

  return (
    <div className="space-y-3">
      {blogs.map((b) => {
        const st = STATUS[b.status] ?? { label: b.status, cls: 'bg-gray-100 text-gray-600' }
        const isEditing = editing === b.id
        return (
          <div key={b.id} className="card-base space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                {isEditing ? (
                  <input value={form.titel ?? ''} onChange={(e) => setForm((f) => ({ ...f, titel: e.target.value }))} className="input-base font-semibold w-full" />
                ) : (
                  <h2 className="font-semibold text-gray-900 flex items-center gap-2"><Newspaper className="h-4 w-4 text-gray-400 shrink-0" />{b.titel}</h2>
                )}
                <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-gray-400">
                  <span className={`status-badge ${st.cls}`}>{st.label}</span>
                  {b.laatst_bewerkt_door && <span>laatst bewerkt door {b.laatst_bewerkt_door}</span>}
                </div>
              </div>
              {!isEditing && canEdit && (
                <button onClick={() => startEdit(b)} className="btn-secondary text-sm shrink-0"><Pencil className="h-3.5 w-3.5" />Bewerken</button>
              )}
            </div>

            {isEditing ? (
              <div className="space-y-3">
                <div>
                  <label className="label-base">Inhoud</label>
                  <textarea value={form.content ?? ''} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} rows={14} className="input-base w-full font-mono text-sm" />
                </div>
                <div className="grid sm:grid-cols-2 gap-3">
                  <div>
                    <label className="label-base">Meta titel</label>
                    <input value={form.meta_title ?? ''} onChange={(e) => setForm((f) => ({ ...f, meta_title: e.target.value }))} className="input-base w-full" />
                  </div>
                  <div>
                    <label className="label-base">Meta beschrijving</label>
                    <input value={form.meta_description ?? ''} onChange={(e) => setForm((f) => ({ ...f, meta_description: e.target.value }))} className="input-base w-full" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => save(b.id)} disabled={saving} className="btn-primary text-sm">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Opslaan</button>
                  <button onClick={() => setEditing(null)} disabled={saving} className="btn-secondary text-sm"><X className="h-4 w-4" />Annuleren</button>
                </div>
                {b.status === 'gepubliceerd' && <p className="text-[11px] text-gray-400">Deze blog staat live — opslaan werkt je website automatisch bij.</p>}
              </div>
            ) : (
              <p className="text-sm text-gray-600 line-clamp-3 whitespace-pre-wrap">{b.content?.slice(0, 280) || '— geen inhoud —'}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}
