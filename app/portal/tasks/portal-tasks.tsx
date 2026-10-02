'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, CheckCircle2, ListChecks, Paperclip } from 'lucide-react'
import { formatDate } from '@/lib/utils'

export type PortalTask = {
  id: string; title: string; description: string | null; deadline: string | null
  priority: string; status: string; client_note: string | null; completed_at: string | null
  attachment_name?: string | null; attachmentUrl?: string | null
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

export function PortalTasks({ initialTasks, canComplete = true }: { initialTasks: PortalTask[]; canComplete?: boolean }) {
  const router = useRouter()
  const [tasks, setTasks] = useState(initialTasks)
  const [busy, setBusy] = useState<string | null>(null)
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [noteText, setNoteText] = useState('')

  const patch = async (id: string, body: object) => {
    setBusy(id)
    try {
      const res = await fetch('/api/portal/tasks', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      router.refresh()
    } catch (e) { alert(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }

  const complete = (id: string) => { setTasks((t) => t.map((x) => x.id === id ? { ...x, status: 'done' } : x)); patch(id, { action: 'complete' }) }
  const saveNote = (id: string) => { patch(id, { note: noteText }); setTasks((t) => t.map((x) => x.id === id ? { ...x, client_note: noteText } : x)); setNoteFor(null); setNoteText('') }

  if (tasks.length === 0) {
    return <div className="card-base empty-state"><ListChecks className="h-8 w-8 mx-auto mb-3 opacity-30" /><p className="text-sm">Je hebt momenteel geen taken.</p></div>
  }

  return (
    <div className="space-y-3">
      {tasks.map((t) => {
        const st = STATUS[t.status] ?? { label: t.status, cls: 'bg-gray-100 text-gray-600' }
        const pr = PRIO[t.priority] ?? PRIO.normaal
        const done = t.status === 'done'
        return (
          <div key={t.id} id={`taak-${t.id}`} className="card-base scroll-mt-24">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium flex items-center gap-2 flex-wrap">
                  {t.title}
                  <span className={`status-badge text-[10px] ${pr.cls}`}>{pr.label}</span>
                </div>
                {t.description && <p className="text-sm text-gray-600 mt-1 whitespace-pre-wrap">{t.description}</p>}
                {t.deadline && <div className="text-xs text-gray-400 mt-1">Deadline: {formatDate(t.deadline)}</div>}
                {t.attachmentUrl && (
                  <a href={t.attachmentUrl} target="_blank" rel="noopener noreferrer" download className="mt-2 inline-flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                    <Paperclip className="h-3.5 w-3.5" />{t.attachment_name || 'Bijlage downloaden'}
                  </a>
                )}
                {t.client_note && <div className="mt-2 text-xs text-gray-600 bg-gray-50 rounded-lg px-2.5 py-1.5">Jouw opmerking: {t.client_note}</div>}
              </div>
              <span className={`status-badge ${st.cls} shrink-0`}>{st.label}</span>
            </div>

            {!done && t.status !== 'cancelled' && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                {canComplete && (
                  <button onClick={() => complete(t.id)} disabled={busy === t.id} className="btn-primary text-xs">
                    {busy === t.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}Markeer als voltooid
                  </button>
                )}
                {noteFor === t.id ? null : (
                  <button onClick={() => { setNoteFor(t.id); setNoteText(t.client_note ?? '') }} className="btn-secondary text-xs">Opmerking toevoegen</button>
                )}
              </div>
            )}

            {noteFor === t.id && (
              <div className="mt-2 space-y-2">
                <textarea rows={2} value={noteText} onChange={(e) => setNoteText(e.target.value)} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" placeholder="Jouw opmerking…" />
                <div className="flex gap-2">
                  <button onClick={() => saveNote(t.id)} disabled={busy === t.id} className="btn-primary text-xs">Opslaan</button>
                  <button onClick={() => { setNoteFor(null); setNoteText('') }} className="btn-secondary text-xs">Annuleer</button>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
