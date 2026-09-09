'use client'

import { useMemo, useState, useCallback } from 'react'
import {
  ChevronLeft, ChevronRight, X, Check, RefreshCw,
  Send, Pencil, Save, Image, Video, FileText, Plus,
} from 'lucide-react'
import { ymd } from '@/lib/utils'
import { KANAAL_SLUGS, kanaalLabel, normaliseerKanalen } from '@/lib/social-platforms'

export type SocialContentStatus =
  | 'draft' | 'ready_for_review' | 'approved'
  | 'changes_requested' | 'scheduled' | 'published'

export type SocialContentItem = {
  id: string
  client_id: string
  planned_date: string
  platform: string
  platforms: string[]
  content_type: string
  title: string
  caption: string | null
  script: string | null
  media_notes: string | null
  status: SocialContentStatus
  client_feedback: string | null
  reviewed_at: string | null
  created_at: string
}

export type CalendarMode = 'admin' | 'client'

const STATUS_STYLE: Record<SocialContentStatus, { dot: string; badge: string; label: string }> = {
  draft: { dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-600 border-gray-200', label: 'Concept' },
  ready_for_review: { dot: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Bij klant' },
  approved: { dot: 'bg-green-500', badge: 'bg-green-50 text-green-700 border-green-200', label: 'Goedgekeurd' },
  changes_requested: { dot: 'bg-red-500', badge: 'bg-red-50 text-red-700 border-red-200', label: 'Feedback' },
  scheduled: { dot: 'bg-blue-500', badge: 'bg-blue-50 text-blue-700 border-blue-200', label: 'Ingepland' },
  published: { dot: 'bg-purple-500', badge: 'bg-purple-50 text-purple-700 border-purple-200', label: 'Gepubliceerd' },
}

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  reel: Video,
  story: Image,
  post: FileText,
  carousel: FileText,
}

const WEEKDAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']

function startOfMonthGrid(d: Date): Date {
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const dow = (first.getDay() + 6) % 7
  return new Date(first.getFullYear(), first.getMonth(), 1 - dow)
}

export type CalendarActions = {
  onUpdate?: (id: string, patch: Partial<SocialContentItem>) => Promise<void>
  onMove?: (id: string, planned_date: string) => Promise<void>
  onSetStatus?: (id: string, status: SocialContentStatus) => Promise<void>
  onDelete?: (id: string) => Promise<void>
  onCreateOnDay?: (planned_date: string) => void
  onApprove?: (id: string) => Promise<void>
  onRequestChanges?: (id: string, feedback: string) => Promise<void>
}

export function ContentCalendar({
  items: itemsProp, mode, actions, selection,
}: {
  items: SocialContentItem[] | null
  mode: CalendarMode
  actions: CalendarActions
  selection?: {
    enabled: boolean
    selectedIds: Set<string>
    onToggle: (id: string) => void
  }
}) {
  const items = itemsProp ?? []
  const [cursor, setCursor] = useState(() => new Date())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [view, setView] = useState<'month' | 'week'>('month')
  const selectMode = !!selection?.enabled

  const selected = items.find((i) => i.id === selectedId) ?? null
  const today = ymd(new Date())

  const days = useMemo(() => {
    const start = view === 'month'
      ? startOfMonthGrid(cursor)
      : (() => {
          const s = new Date(cursor)
          const dow = (s.getDay() + 6) % 7
          return new Date(s.getFullYear(), s.getMonth(), s.getDate() - dow)
        })()
    return Array.from({ length: view === 'month' ? 42 : 7 }, (_, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      return d
    })
  }, [cursor, view])

  const byDay = useMemo(() => {
    const map = new Map<string, SocialContentItem[]>()
    for (const it of items) {
      const list = map.get(it.planned_date) ?? []
      list.push(it)
      map.set(it.planned_date, list)
    }
    return map
  }, [items])

  const title = cursor.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' })

  const navigate = (delta: number) => {
    const d = new Date(cursor)
    if (view === 'month') d.setMonth(d.getMonth() + delta)
    else d.setDate(d.getDate() + delta * 7)
    setCursor(d)
  }

  const onDrop = async (e: React.DragEvent, dayStr: string) => {
    if (mode !== 'admin') return
    e.preventDefault()
    const id = e.dataTransfer.getData('text/plain')
    if (id && actions.onMove) await actions.onMove(id, dayStr)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Script panel — on mobile appears ABOVE calendar when an item is selected */}
      {selected && (
        <div className="lg:hidden">
          <ScriptPanel item={selected} mode={mode} actions={actions} onClose={() => setSelectedId(null)} />
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
      {/* Calendar grid */}
      <div className="flex-1 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
          <div className="flex items-center gap-1">
            <button onClick={() => navigate(-1)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCursor(new Date())}
              className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50"
            >
              Vandaag
            </button>
            <button onClick={() => navigate(1)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100">
              <ChevronRight className="h-4 w-4" />
            </button>
            <span className="ml-2 font-semibold capitalize text-sm">{title}</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setView('month')}
              className={`text-xs px-3 py-1.5 rounded-lg border ${view === 'month' ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50'}`}
            >
              Maand
            </button>
            <button
              onClick={() => setView('week')}
              className={`text-xs px-3 py-1.5 rounded-lg border ${view === 'week' ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50'}`}
            >
              Week
            </button>
          </div>
        </div>

        {/* Weekdays header */}
        <div className="grid grid-cols-7 border-b border-gray-100">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wider py-2">
              {w}
            </div>
          ))}
        </div>

        {/* Days grid */}
        <div className={`grid grid-cols-7 ${view === 'month' ? 'grid-rows-6' : 'grid-rows-1'}`}>
          {days.map((d, idx) => {
            const dayStr = ymd(d)
            const inMonth = view === 'week' || d.getMonth() === cursor.getMonth()
            const isToday = dayStr === today
            const dayItems = byDay.get(dayStr) ?? []
            const maxShow = view === 'week' ? 10 : 3
            const canAdd = mode === 'admin' && !!actions.onCreateOnDay

            return (
              <div
                key={idx}
                onDragOver={(e) => mode === 'admin' && e.preventDefault()}
                onDrop={(e) => onDrop(e, dayStr)}
                className={`group relative border-r border-b border-gray-100 p-1.5 flex flex-col gap-1
                  ${view === 'month' ? 'min-h-[100px]' : 'min-h-[200px]'}
                  ${!inMonth ? 'bg-gray-50/50' : ''}
                  ${canAdd ? 'hover:bg-yellow-50/30 cursor-pointer' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] font-medium px-1 py-0.5 rounded-full
                    ${isToday ? 'bg-[#fff848] text-black font-bold' : inMonth ? 'text-gray-700' : 'text-gray-300'}`}>
                    {d.getDate()}
                  </span>
                  {canAdd && inMonth && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); actions.onCreateOnDay?.(dayStr) }}
                      className="opacity-0 group-hover:opacity-100 h-5 w-5 flex items-center justify-center rounded text-gray-400 hover:bg-[#fff848] hover:text-black transition-all"
                    >
                      <Plus className="h-3 w-3" />
                    </button>
                  )}
                </div>

                <div className="flex flex-col gap-0.5 overflow-hidden">
                  {dayItems.slice(0, maxShow).map((it) => {
                    const Icon = TYPE_ICONS[it.content_type] ?? FileText
                    const style = STATUS_STYLE[it.status]
                    const isChecked = selection?.selectedIds.has(it.id) ?? false
                    return (
                      <button
                        key={it.id}
                        draggable={mode === 'admin' && !selectMode}
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', it.id)}
                        onClick={() => {
                          if (selectMode) {
                            selection?.onToggle(it.id)
                          } else {
                            setSelectedId(it.id === selectedId ? null : it.id)
                          }
                        }}
                        className={`text-left text-[11px] px-1.5 py-1 rounded border ${style.badge}
                          hover:opacity-80 transition truncate flex items-center gap-1 w-full
                          ${isChecked ? 'ring-2 ring-red-400 bg-red-50' : ''}`}
                        title={it.title}
                      >
                        {selectMode && (
                          <span className={`h-3 w-3 shrink-0 rounded border flex items-center justify-center ${
                            isChecked ? 'bg-red-500 border-red-500' : 'border-gray-300 bg-white'
                          }`}>
                            {isChecked && <Check className="h-2 w-2 text-white" />}
                          </span>
                        )}
                        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${style.dot}`} />
                        <Icon className="h-2.5 w-2.5 shrink-0 opacity-70" />
                        <span className="truncate">{it.title}</span>
                      </button>
                    )
                  })}
                  {dayItems.length > maxShow && (
                    <div className="text-[10px] text-gray-400 px-1">
                      +{dayItems.length - maxShow} meer
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* Legend */}
        <div className="flex flex-wrap gap-4 px-4 py-3 border-t border-gray-100">
          {(Object.entries(STATUS_STYLE) as [SocialContentStatus, typeof STATUS_STYLE[SocialContentStatus]][]).map(([s, v]) => (
            <span key={s} className="flex items-center gap-1.5 text-[11px] text-gray-500">
              <span className={`h-2 w-2 rounded-full ${v.dot}`} />
              {v.label}
            </span>
          ))}
        </div>
      </div>

      {/* Script panel — desktop only (mobile version shown above) */}
      <div className="hidden lg:block lg:w-[360px]">
        <ScriptPanel
          item={selected}
          mode={mode}
          actions={actions}
          onClose={() => setSelectedId(null)}
        />
      </div>
    </div>
    </div>
  )
}

function ScriptPanel({
  item, mode, actions, onClose,
}: {
  item: SocialContentItem | null
  mode: CalendarMode
  actions: CalendarActions
  onClose: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<SocialContentItem | null>(null)
  const [feedback, setFeedback] = useState('')
  const [busy, setBusy] = useState(false)

  if (item && form?.id !== item.id) {
    setForm(item)
    setEditing(false)
    setFeedback(item.client_feedback ?? '')
  }

  if (!item) {
    return (
      <aside className="w-full bg-white border border-gray-200 rounded-xl p-5 h-fit shadow-sm">
        <div className="text-center py-8">
          <FileText className="h-8 w-8 text-gray-200 mx-auto mb-3" />
          <p className="text-sm text-gray-400">Klik op een item om details te bekijken</p>
        </div>
      </aside>
    )
  }

  const f = form ?? item
  const isAdmin = mode === 'admin'
  const style = STATUS_STYLE[item.status]
  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'

  const save = async () => {
    if (!isAdmin || !actions.onUpdate || !form) return
    setBusy(true)
    try {
      const resolvedPlatforms = normaliseerKanalen(
        form.platforms?.length > 0 ? form.platforms : [form.platform],
      )
      await actions.onUpdate(item.id, {
        title: form.title,
        platforms: resolvedPlatforms,
        platform: resolvedPlatforms[0],
        content_type: form.content_type, planned_date: form.planned_date,
        caption: form.caption, script: form.script, media_notes: form.media_notes,
      })
      setEditing(false)
    } finally { setBusy(false) }
  }

  // Eén bron (lib/social-platforms.ts); Instagram + Facebook = Meta.
  const ALL_PLATFORMS = KANAAL_SLUGS
  const togglePlatform = (p: string) => {
    if (!form) return
    const current = normaliseerKanalen(form.platforms?.length > 0 ? form.platforms : [form.platform])
    const next = current.includes(p) ? current.filter((x) => x !== p) : [...current, p]
    setForm({ ...form, platforms: next.length > 0 ? next : [p], platform: next[0] ?? p })
  }

  return (
    <aside className="w-full bg-white border border-gray-200 rounded-xl shadow-sm h-fit lg:sticky lg:top-6 max-h-[80vh] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 border-b border-gray-100 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span className={`status-badge border ${style.badge}`}>{style.label}</span>
            <span className="text-xs text-gray-400">{f.planned_date}</span>
          </div>
          {editing ? (
            <input
              className={inp}
              value={f.title}
              onChange={(e) => setForm({ ...f, title: e.target.value })}
            />
          ) : (
            <h3 className="font-semibold text-gray-900 leading-snug">{f.title}</h3>
          )}
          <div className="text-xs text-gray-400 mt-1 flex items-center gap-1 flex-wrap">
            {/* Oude items staan nog op 'instagram'/'facebook'; normaliseren
                toont die als één Meta-badge in plaats van twee. */}
            {normaliseerKanalen(f.platforms?.length > 0 ? f.platforms : [f.platform]).map((p) => (
              <span key={p} className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[10px]">{kanaalLabel(p)}</span>
            ))}
            <span>· {f.content_type}</span>
          </div>
        </div>
        <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 shrink-0">
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {editing && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label>
                <span className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Datum</span>
                <input type="date" className={inp} value={f.planned_date} onChange={(e) => setForm({ ...f, planned_date: e.target.value })} />
              </label>
              <label>
                <span className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Type</span>
                <select className={inp} value={f.content_type} onChange={(e) => setForm({ ...f, content_type: e.target.value })}>
                  {['post', 'reel', 'story', 'carousel'].map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </label>
            </div>
            <div>
              <span className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">
                Kanalen <span className="normal-case text-gray-400">(meerdere mogelijk)</span>
              </span>
              <div className="flex flex-wrap gap-1.5">
                {ALL_PLATFORMS.map((p) => {
                  const active = normaliseerKanalen(
                    f.platforms?.length > 0 ? f.platforms : [f.platform],
                  ).includes(p)
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => togglePlatform(p)}
                      className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                        active
                          ? 'border-[#fff848] bg-[#fff848]/10 text-black'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {kanaalLabel(p)}
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {(editing || f.caption) && (
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Caption</div>
            {editing ? (
              <textarea rows={3} value={f.caption ?? ''} onChange={(e) => setForm({ ...f, caption: e.target.value })} className={inp} />
            ) : (
              <p className="text-sm whitespace-pre-wrap text-gray-700 leading-relaxed">{f.caption}</p>
            )}
          </div>
        )}

        {(editing || f.script) && (
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Script / Hook / CTA</div>
            {editing ? (
              <textarea rows={6} value={f.script ?? ''} onChange={(e) => setForm({ ...f, script: e.target.value })} className={inp} />
            ) : (
              <p className="text-sm whitespace-pre-wrap text-gray-700 leading-relaxed">{f.script}</p>
            )}
          </div>
        )}

        {(editing || f.media_notes) && (
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Media-notities</div>
            {editing ? (
              <textarea rows={3} value={f.media_notes ?? ''} onChange={(e) => setForm({ ...f, media_notes: e.target.value })} className={inp} />
            ) : (
              <p className="text-sm whitespace-pre-wrap text-gray-700">{f.media_notes}</p>
            )}
          </div>
        )}

        {item.status === 'changes_requested' && item.client_feedback && (
          <div className="text-sm rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
            <strong className="block mb-1 text-xs uppercase tracking-wide">Feedback klant</strong>
            {item.client_feedback}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 border-t border-gray-100 space-y-3">
        {isAdmin ? (
          <>
            <div className="flex gap-2">
              {editing ? (
                <>
                  <button disabled={busy} onClick={save} className="btn-primary flex-1">
                    {busy ? <span className="h-4 w-4 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Opslaan
                  </button>
                  <button onClick={() => { setForm(item); setEditing(false) }} className="btn-secondary">
                    Annuleer
                  </button>
                </>
              ) : (
                <button onClick={() => setEditing(true)} className="btn-secondary w-full">
                  <Pencil className="h-3.5 w-3.5" />
                  Bewerken
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(item.status === 'draft' || item.status === 'changes_requested') && (
                <button
                  disabled={busy}
                  onClick={async () => { setBusy(true); try { await actions.onSetStatus?.(item.id, 'ready_for_review') } finally { setBusy(false) } }}
                  className="btn-secondary text-xs flex-1"
                >
                  <Send className="h-3 w-3" />
                  Naar klant
                </button>
              )}
              {item.status === 'approved' && (
                <button
                  disabled={busy}
                  onClick={async () => { setBusy(true); try { await actions.onSetStatus?.(item.id, 'scheduled') } finally { setBusy(false) } }}
                  className="btn-secondary text-xs"
                >
                  Inplannen
                </button>
              )}
              {item.status === 'scheduled' && (
                <button
                  disabled={busy}
                  onClick={async () => { setBusy(true); try { await actions.onSetStatus?.(item.id, 'published') } finally { setBusy(false) } }}
                  className="btn-secondary text-xs"
                >
                  Gepubliceerd
                </button>
              )}
              {actions.onDelete && (
                <button
                  disabled={busy}
                  onClick={async () => {
                    if (!confirm('Item verwijderen?')) return
                    setBusy(true)
                    try { await actions.onDelete!(item.id); onClose() } finally { setBusy(false) }
                  }}
                  className="btn-danger text-xs ml-auto"
                >
                  Verwijder
                </button>
              )}
            </div>
          </>
        ) : (
          <>
            {(item.status === 'ready_for_review' || item.status === 'changes_requested') ? (
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">
                    Feedback / opmerkingen
                  </label>
                  <textarea
                    rows={3}
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    className={inp}
                    placeholder="Wat zou je aanpassen?"
                  />
                </div>
                <div className="flex gap-2">
                  <button
                    disabled={busy || !feedback.trim()}
                    onClick={async () => { setBusy(true); try { await actions.onRequestChanges?.(item.id, feedback) } finally { setBusy(false) } }}
                    className="btn-secondary flex-1 text-xs"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Feedback
                  </button>
                  <button
                    disabled={busy}
                    onClick={async () => { setBusy(true); try { await actions.onApprove?.(item.id) } finally { setBusy(false) } }}
                    className="btn-primary flex-1 text-xs"
                  >
                    <Check className="h-3 w-3" />
                    Goedkeuren
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400 text-center">Geen actie vereist op dit moment.</p>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
