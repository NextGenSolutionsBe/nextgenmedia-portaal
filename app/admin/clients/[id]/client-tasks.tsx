'use client'

import { useCallback, useEffect, useState } from 'react'
import { Plus, X, Loader2, Pencil, Trash2, Paperclip, ListChecks, CheckCircle2 } from 'lucide-react'
import { formatDate } from '@/lib/utils'
import { SendMailButton } from '@/components/admin/send-mail-button'
import { readJson, fileTooBig, MAX_UPLOAD_MB } from '@/lib/upload'

type Task = {
  id: string; title: string; description: string | null; deadline: string | null
  priority: string; status: string; client_note: string | null; completed_at: string | null
  attachmentUrl?: string | null; attachment_name?: string | null
}

const STATUS: Record<string, { label: string; cls: string }> = {
  open: { label: 'Open', cls: 'bg-blue-100 text-blue-700' },
  in_progress: { label: 'In behandeling', cls: 'bg-purple-100 text-purple-700' },
  done: { label: 'Voltooid', cls: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Geannuleerd', cls: 'bg-gray-100 text-gray-600' },
}
const PRIO: Record<string, { label: string; cls: string }> = {
  laag: { label: 'Laag', cls: 'bg-gray-100 text-gray-600' },
  normaal: { label: 'Normaal', cls: 'bg-sky-100 text-sky-700' },
  hoog: { label: 'Hoog', cls: 'bg-red-100 text-red-700' },
}
const STATUS_OPTS = ['open', 'in_progress', 'done', 'cancelled']

export function ClientTasks({ clientId }: { clientId: string }) {
  const [tasks, setTasks] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<{ task: Task | null } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/tasks?client_id=${clientId}`)
      const j = await res.json()
      if (res.ok) setTasks((j.tasks ?? []) as Task[])
    } catch { /* stil */ } finally { setLoading(false) }
  }, [clientId])

  useEffect(() => { load() }, [load])

  const setStatus = async (id: string, status: string) => {
    setBusy(id); setTasks((t) => t.map((x) => x.id === id ? { ...x, status } : x))
    try {
      await fetch('/api/admin/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, status, client_id: clientId }) })
    } finally { setBusy(null) }
  }
  const remove = async (id: string) => {
    if (!confirm('Taak verwijderen?')) return
    setBusy(id)
    try { await fetch(`/api/admin/tasks?id=${id}`, { method: 'DELETE' }); setTasks((t) => t.filter((x) => x.id !== id)) } finally { setBusy(null) }
  }

  return (
    <div className="card-base space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-sm text-gray-900 flex items-center gap-2"><ListChecks className="h-4 w-4 text-gray-400" />Taken</h2>
        <button onClick={() => setDialog({ task: null })} className="text-xs text-gray-500 hover:text-black inline-flex items-center gap-1"><Plus className="h-3.5 w-3.5" />Taak</button>
      </div>

      {loading ? (
        <div className="py-4 text-center text-gray-400"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-gray-400">Nog geen taken.</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((t) => {
            const st = STATUS[t.status] ?? { label: t.status, cls: 'bg-gray-100 text-gray-600' }
            const pr = PRIO[t.priority] ?? PRIO.normaal
            return (
              <div key={t.id} className="rounded-xl border border-gray-100 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium flex items-center gap-2 flex-wrap">
                      {t.title}
                      <span className={`status-badge text-[10px] ${pr.cls}`}>{pr.label}</span>
                    </div>
                    {t.description && <p className="text-xs text-gray-500 mt-0.5 whitespace-pre-wrap">{t.description}</p>}
                    <div className="text-[11px] text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
                      {t.deadline && <span>Deadline {formatDate(t.deadline)}</span>}
                      {t.attachmentUrl && <a href={t.attachmentUrl} target="_blank" rel="noreferrer" download className="inline-flex items-center gap-1 text-blue-600 hover:underline"><Paperclip className="h-3 w-3" />{t.attachment_name || 'Bijlage'}</a>}
                    </div>
                    {t.client_note && <div className="mt-1 text-xs text-gray-600 bg-gray-50 rounded-lg px-2 py-1">Opmerking klant: {t.client_note}</div>}
                    {t.completed_at && <div className="mt-1 text-[11px] text-green-600 inline-flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />Klant voltooide op {formatDate(t.completed_at)}</div>}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setDialog({ task: t })} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400" title="Bewerken"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => remove(t.id)} disabled={busy === t.id} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400" title="Verwijderen">{busy === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>
                  </div>
                </div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <select value={t.status} onChange={(e) => setStatus(t.id, e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1 text-xs">
                    {STATUS_OPTS.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
                  </select>
                  <SendMailButton clientId={clientId} kind="task" taskId={t.id} label="Mail klant" className="btn-secondary text-xs" />
                  <span className={`status-badge text-[10px] ${st.cls}`}>{st.label}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {dialog && (
        <TaskDialog clientId={clientId} task={dialog.task} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); load() }} />
      )}
    </div>
  )
}

function TaskDialog({ clientId, task, onClose, onSaved }: { clientId: string; task: Task | null; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!task
  const [title, setTitle] = useState(task?.title ?? '')
  const [description, setDescription] = useState(task?.description ?? '')
  const [deadline, setDeadline] = useState(task?.deadline ?? '')
  const [priority, setPriority] = useState(task?.priority ?? 'normaal')
  const [status, setStatus] = useState(task?.status ?? 'open')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!title.trim()) { setError('Titel is verplicht'); return }
    if (fileTooBig(file)) { setError(`Bijlage te groot — max ${MAX_UPLOAD_MB} MB.`); return }
    setLoading(true); setError(null)
    try {
      let res: Response
      if (isEdit) {
        res = await fetch('/api/admin/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: task!.id, title, description, deadline: deadline || null, priority, status, client_id: clientId }) })
      } else {
        const fd = new FormData()
        fd.append('client_id', clientId); fd.append('title', title); fd.append('description', description)
        fd.append('deadline', deadline); fd.append('priority', priority); fd.append('status', status)
        if (file) fd.append('attachment', file)
        res = await fetch('/api/admin/tasks', { method: 'POST', body: fd })
      }
      await readJson(res)
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout') } finally { setLoading(false) }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold">{isEdit ? 'Taak bewerken' : 'Nieuwe taak'}</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Titel</label>
            <input className={inp} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Bv. Logo aanleveren" />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Beschrijving</label>
            <textarea rows={3} className={inp} value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Deadline</label>
              <input type="date" className={inp} value={deadline} onChange={(e) => setDeadline(e.target.value)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Prioriteit</label>
              <select className={inp} value={priority} onChange={(e) => setPriority(e.target.value)}>
                <option value="laag">Laag</option><option value="normaal">Normaal</option><option value="hoog">Hoog</option>
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
            <select className={inp} value={status} onChange={(e) => setStatus(e.target.value)}>
              {STATUS_OPTS.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
            </select>
          </div>
          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Bijlage (optioneel)</label>
              <input type="file" className="text-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </div>
          )}
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
