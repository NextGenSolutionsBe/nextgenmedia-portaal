'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, Trash2, RefreshCw, Save, Eye, Pencil, AlertTriangle, Newspaper, History, RotateCcw, UploadCloud, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils'

export type ReviewBlog = {
  id: string; account_id: string | null; account_name?: string; titel: string; slug: string
  content: string | null; meta_title: string | null; meta_description: string | null; thumbnail_url: string | null
  status: string; foutmelding: string | null; gegenereerd_op: string
  sync_status: string | null; publish_mode: string | null; publish_at: string | null
  laatst_bewerkt_door: string | null; laatst_bewerkt_op: string | null
  tags: string[] | null
}

type Version = {
  id: string; titel: string | null; slug: string | null; content: string | null
  meta_title: string | null; meta_description: string | null
  edited_by: string | null; change_summary: string | null; created_at: string
}

const STATUS_LABEL: Record<string, string> = { klaar_voor_review: 'Klaar voor review', goedgekeurd: 'Goedgekeurd', gepubliceerd: 'Gepubliceerd', gefaald: 'Gefaald' }
const STATUS_CLS: Record<string, string> = { klaar_voor_review: 'bg-amber-100 text-amber-700', goedgekeurd: 'bg-blue-100 text-blue-700', gepubliceerd: 'bg-green-100 text-green-700', gefaald: 'bg-red-100 text-red-700' }
const STATUSES = ['klaar_voor_review', 'goedgekeurd', 'gepubliceerd', 'gefaald']

// Synchronisatiestatus 🟢🟠🔴
function SyncBadge({ blog }: { blog: ReviewBlog }) {
  if (blog.status !== 'gepubliceerd' && blog.sync_status !== 'failed' && blog.sync_status !== 'pending') return null
  const map: Record<string, { dot: string; label: string }> = {
    synced: { dot: 'bg-green-500', label: '🟢 Gesynchroniseerd' },
    pending: { dot: 'bg-amber-500', label: '🟠 Wacht op synchronisatie' },
    failed: { dot: 'bg-red-500', label: '🔴 Synchronisatie mislukt' },
  }
  const s = map[blog.sync_status ?? (blog.status === 'gepubliceerd' ? 'synced' : '')] ?? null
  if (!s) return null
  return <span className="inline-flex items-center gap-1 text-[10px] text-gray-500"><span className={`h-2 w-2 rounded-full ${s.dot}`} />{s.label}</span>
}

export function BlogReview({ initialBlogs, accounts, initialAccount }: { initialBlogs: ReviewBlog[]; accounts: { id: string; name: string }[]; initialAccount: string }) {
  const router = useRouter()
  const [blogs, setBlogs] = useState(initialBlogs)
  const [fAccount, setFAccount] = useState(initialAccount)
  const [fStatus, setFStatus] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const filtered = blogs.filter((b) => (!fAccount || b.account_id === fAccount) && (!fStatus || b.status === fStatus))
  const refresh = () => router.refresh()

  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allSelected = filtered.length > 0 && filtered.every((b) => selected.has(b.id))
  const toggleAll = () => setSelected((s) => { if (allSelected) return new Set() ; const n = new Set(s); filtered.forEach((b) => n.add(b.id)); return n })

  const bulk = async (op: 'approve' | 'publish' | 'delete' | 'regenerate') => {
    const ids = filtered.filter((b) => selected.has(b.id)).map((b) => b.id)
    if (ids.length === 0) return
    const labels: Record<string, string> = { approve: 'goedkeuren & publiceren', publish: 'publiceren', delete: 'verwijderen', regenerate: 'opnieuw genereren' }
    if (!confirm(`${ids.length} blog(s) ${labels[op]}?`)) return
    setBulkBusy(true)
    try {
      const res = await fetch('/api/admin/blogs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'bulk', op, ids }) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      if (op === 'delete') { setBlogs((x) => x.filter((b) => !selected.has(b.id))); toast.success(`${j.count} verwijderd.`) }
      else if (op === 'regenerate') toast.success(`${j.count} opnieuw gegenereerd.`)
      else toast.success(`${j.published ?? 0} gepubliceerd${j.pending ? `, ${j.pending} in wachtrij` : ''}${j.failed ? `, ${j.failed} mislukt` : ''}.`)
      setSelected(new Set())
      refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setBulkBusy(false) }
  }

  const act = async (id: string, body: object, okMsg?: string) => {
    setBusy(id)
    try {
      const res = await fetch('/api/admin/blogs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      if (body && (body as { action?: string }).action === 'approve') {
        if (j.scheduled) { toast.success('Ingepland voor latere publicatie.'); refresh(); return }
        if (j.needsConfirm) {
          setBusy(null)
          if (confirm(`${j.warning ?? 'Er staan nog niet-gepubliceerde wijzigingen in dit Framer-project.'}\n\nToch publiceren?`)) {
            await act(id, { ...body, confirm_override: true })
          }
          return
        }
        if (j.published) {
          toast.success('Gepubliceerd op Framer.')
          if (j.firstPublish) toast.message('Eerste publicatie voor deze klant — controleer het resultaat op de website.')
          if (j.maxLiveTrimmed) toast.message(`${j.maxLiveTrimmed} oudere blog(s) op draft gezet (maximum live bereikt).`)
        } else if (j.pending) {
          toast.message('Goedgekeurd — Publicatie gestart.')
        } else {
          toast.error(`Publicatie mislukt: ${j.error ?? 'onbekend'}`)
        }
      } else if (okMsg) toast.success(okMsg)
      refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }

  const remove = async (id: string) => {
    if (!confirm('Deze blog afkeuren/verwijderen?')) return
    setBusy(id)
    try { await fetch(`/api/admin/blogs?id=${id}`, { method: 'DELETE' }); setBlogs((x) => x.filter((b) => b.id !== id)) } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        <select value={fAccount} onChange={(e) => setFAccount(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"><option value="">Alle blogaccounts</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"><option value="">Alle statussen</option>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}</select>
        <span className="text-xs text-gray-400">{filtered.length} blog(s)</span>
        {filtered.length > 0 && <label className="text-xs text-gray-500 flex items-center gap-1.5 ml-1"><input type="checkbox" checked={allSelected} onChange={toggleAll} />alles</label>}
      </div>

      {selected.size > 0 && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200 bg-white/95 backdrop-blur px-3 py-2 shadow-sm">
          <span className="text-xs font-medium text-gray-600">{selected.size} geselecteerd</span>
          <button onClick={() => bulk('approve')} disabled={bulkBusy} className="btn-primary text-xs">{bulkBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Goedkeuren & publiceren</button>
          <button onClick={() => bulk('publish')} disabled={bulkBusy} className="btn-secondary text-xs"><UploadCloud className="h-3.5 w-3.5" />Publiceren</button>
          <button onClick={() => bulk('regenerate')} disabled={bulkBusy} className="btn-secondary text-xs"><RefreshCw className="h-3.5 w-3.5" />Opnieuw genereren</button>
          <button onClick={() => bulk('delete')} disabled={bulkBusy} className="btn-secondary text-xs text-red-600"><Trash2 className="h-3.5 w-3.5" />Verwijderen</button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-gray-400 hover:text-gray-700 ml-auto">Selectie wissen</button>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="card-base empty-state"><Newspaper className="h-8 w-8 mx-auto mb-3 opacity-30" /><p className="text-sm">Geen blogs voor deze selectie.</p></div>
      ) : (
        <div className="space-y-3">
          {filtered.map((b) => (
            <BlogCard key={b.id} blog={b} editing={editing === b.id} busy={busy === b.id} selected={selected.has(b.id)}
              onToggle={() => toggle(b.id)}
              onEdit={() => setEditing(editing === b.id ? null : b.id)}
              onSave={(patch) => { act(b.id, { ...patch }, 'Opgeslagen.'); setEditing(null) }}
              onApprove={(extra) => act(b.id, { action: 'approve', ...extra })}
              onRegenerate={() => act(b.id, { action: 'regenerate' }, 'Opnieuw gegenereerd.')}
              onRestore={(versionId) => act(b.id, { action: 'restore_version', version_id: versionId }, 'Versie hersteld.')}
              onDelete={() => remove(b.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function BlogCard({ blog, editing, busy, selected, onToggle, onEdit, onSave, onApprove, onRegenerate, onRestore, onDelete }: {
  blog: ReviewBlog; editing: boolean; busy: boolean; selected: boolean
  onToggle: () => void; onEdit: () => void; onSave: (p: Partial<ReviewBlog>) => void
  onApprove: (extra?: object) => void; onRegenerate: () => void; onRestore: (versionId: string) => void; onDelete: () => void
}) {
  const [f, setF] = useState({ titel: blog.titel, slug: blog.slug, content: blog.content ?? '', meta_title: blog.meta_title ?? '', meta_description: blog.meta_description ?? '', thumbnail_url: blog.thumbnail_url ?? '' })
  const [preview, setPreview] = useState(false)
  const [pubMode, setPubMode] = useState(blog.publish_mode || 'now')
  const [versions, setVersions] = useState<Version[] | null>(null)
  const [loadingV, setLoadingV] = useState(false)
  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  const canApprove = blog.status === 'klaar_voor_review' || blog.status === 'goedgekeurd' || blog.status === 'gefaald'

  const approve = () => {
    if (pubMode === 'scheduled') {
      const when = prompt('Publiceren op (JJJJ-MM-DD UU:MM):', new Date(Date.now() + 86400000).toISOString().slice(0, 16).replace('T', ' '))
      if (!when) return
      const iso = new Date(when.replace(' ', 'T')).toISOString()
      onApprove({ publish_mode: 'scheduled', publish_at: iso })
    } else {
      onApprove({ publish_mode: pubMode })
    }
  }

  const loadVersions = async () => {
    if (versions) { setVersions(null); return }
    setLoadingV(true)
    try { const res = await fetch(`/api/admin/blogs?versions=${blog.id}`); const j = await res.json(); if (res.ok) setVersions(j.versions ?? []) } finally { setLoadingV(false) }
  }

  return (
    <div className="card-base">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <input type="checkbox" checked={selected} onChange={onToggle} className="mt-1" />
          <div className="min-w-0">
            <div className="font-medium flex items-center gap-2 flex-wrap">{blog.titel}<span className={`status-badge text-[10px] ${STATUS_CLS[blog.status] ?? 'bg-gray-100 text-gray-600'}`}>{STATUS_LABEL[blog.status] ?? blog.status}</span><SyncBadge blog={blog} /></div>
            <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-x-2">
              <span>{blog.account_name} · {formatDate(blog.gegenereerd_op)} · /{blog.slug}</span>
              {blog.laatst_bewerkt_door && <span>· laatst bewerkt door {blog.laatst_bewerkt_door}</span>}
              {blog.publish_at && blog.status === 'goedgekeurd' && <span className="text-amber-600">· gepland {formatDate(blog.publish_at)}</span>}
            </div>
            {blog.tags && blog.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">{blog.tags.map((t) => <span key={t} className="status-badge bg-indigo-50 text-indigo-700 text-[10px]">{t}</span>)}</div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={() => setPreview((p) => !p)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400" title="Preview"><Eye className="h-3.5 w-3.5" /></button>
          <button onClick={loadVersions} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400" title="Versiegeschiedenis">{loadingV ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <History className="h-3.5 w-3.5" />}</button>
          <button onClick={onEdit} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400" title="Bewerken"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={onDelete} disabled={busy} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400" title="Afkeuren/verwijderen">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>
        </div>
      </div>

      {blog.foutmelding && (
        <div className="mt-2 flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" /><span>{blog.foutmelding}</span>
        </div>
      )}

      {versions && (
        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3">
          <div className="text-[11px] font-medium text-gray-500 mb-2">Versiegeschiedenis</div>
          {versions.length === 0 ? <p className="text-xs text-gray-400">Nog geen eerdere versies.</p> : (
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              {versions.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="text-gray-500 min-w-0 truncate">{formatDate(v.created_at)} · {v.edited_by ?? '—'} · <span className="text-gray-400">{v.change_summary ?? ''}</span></span>
                  <button onClick={() => onRestore(v.id)} disabled={busy} className="btn-secondary text-[11px] shrink-0"><RotateCcw className="h-3 w-3" />Herstellen</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {preview && !editing && (
        <div className="mt-3 rounded-lg border border-gray-100 bg-gray-50/60 p-3 max-h-80 overflow-y-auto">
          <div className="text-[11px] text-gray-400 mb-1">{blog.meta_title} — {blog.meta_description}</div>
          <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans">{blog.content}</pre>
        </div>
      )}

      {editing && (
        <div className="mt-3 space-y-2">
          <input className={inp} value={f.titel} onChange={(e) => setF((x) => ({ ...x, titel: e.target.value }))} placeholder="Titel" />
          <input className={inp} value={f.slug} onChange={(e) => setF((x) => ({ ...x, slug: e.target.value }))} placeholder="slug" />
          <textarea rows={10} className={`${inp} font-mono text-xs`} value={f.content} onChange={(e) => setF((x) => ({ ...x, content: e.target.value }))} placeholder="Content (Markdown/HTML)" />
          <div className="grid grid-cols-2 gap-2">
            <input className={inp} value={f.meta_title} onChange={(e) => setF((x) => ({ ...x, meta_title: e.target.value }))} placeholder="Meta title" />
            <input className={inp} value={f.thumbnail_url} onChange={(e) => setF((x) => ({ ...x, thumbnail_url: e.target.value }))} placeholder="Thumbnail URL" />
          </div>
          <input className={inp} value={f.meta_description} onChange={(e) => setF((x) => ({ ...x, meta_description: e.target.value }))} placeholder="Meta description" />
          <button onClick={() => onSave(f)} disabled={busy} className="btn-secondary text-xs"><Save className="h-3.5 w-3.5" />Opslaan</button>
        </div>
      )}

      <div className="mt-3 flex items-center gap-2 flex-wrap">
        {canApprove && blog.status !== 'gepubliceerd' && (
          <>
            <select value={pubMode} onChange={(e) => setPubMode(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs" title="Publicatiemoment">
              <option value="now">Publiceer nu</option>
              <option value="scheduled">Publiceer later</option>
              <option value="auto">Automatisch</option>
            </select>
            <button onClick={approve} disabled={busy} className="btn-primary text-xs">{busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : pubMode === 'scheduled' ? <Clock className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}{blog.status === 'gefaald' ? 'Opnieuw publiceren' : pubMode === 'scheduled' ? 'Inplannen' : 'Goedkeuren & publiceren'}</button>
          </>
        )}
        <button onClick={onRegenerate} disabled={busy} className="btn-secondary text-xs"><RefreshCw className="h-3.5 w-3.5" />Opnieuw genereren</button>
      </div>
    </div>
  )
}
