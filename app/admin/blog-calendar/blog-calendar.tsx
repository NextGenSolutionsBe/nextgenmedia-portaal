'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, CalendarDays, Sparkles, Eye, Clock, CheckCircle2, X, Loader2, Save, RefreshCw, Trash2, UploadCloud, FileText, ImageIcon } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils'
import { postJson, patchJson } from '@/lib/api-client'

export type CalBlog = {
  id: string; titel: string; slug: string; content: string | null
  meta_title: string | null; meta_description: string | null; thumbnail_url: string | null
  status: string; account_id: string | null; account_name?: string
  gegenereerd_op: string | null; gepubliceerd_op: string | null; publish_at: string | null; publish_mode: string | null
  sync_status: string | null; foutmelding: string | null; tags: string[] | null
}
export type CalEvent = { date: string; kind: 'generation' | 'review' | 'scheduled' | 'published'; blogId?: string; titel?: string; account_id?: string | null }

const KIND: Record<CalEvent['kind'], { label: string; cls: string; dot: string; Icon: typeof Eye }> = {
  generation: { label: 'Generatie', cls: 'bg-blue-100 text-blue-700', dot: 'bg-blue-500', Icon: Sparkles },
  review: { label: 'Te beoordelen', cls: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500', Icon: Eye },
  scheduled: { label: 'Gepland/goedgekeurd', cls: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500', Icon: Clock },
  published: { label: 'Gepubliceerd', cls: 'bg-green-100 text-green-700', dot: 'bg-green-500', Icon: CheckCircle2 },
}
const DOW = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']
const MONTHS = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

const iso = (d: Date) => d.toISOString().slice(0, 10)
const startOfWeek = (d: Date) => { const x = new Date(d); const dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); x.setHours(0, 0, 0, 0); return x }

export function BlogCalendar({ events, blogs, accounts, initialAccount }: { events: CalEvent[]; blogs: CalBlog[]; accounts: { id: string; name: string }[]; initialAccount: string }) {
  const [view, setView] = useState<'maand' | 'week' | 'lijst'>('maand')
  const [cursor, setCursor] = useState(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d })
  const [fAccount, setFAccount] = useState(initialAccount)
  const [open, setOpen] = useState<CalBlog | null>(null)

  const blogById = useMemo(() => new Map(blogs.map((b) => [b.id, b])), [blogs])
  const filtered = useMemo(() => events.filter((e) => !fAccount || e.account_id === fAccount), [events, fAccount])

  const byDate = useMemo(() => {
    const m = new Map<string, CalEvent[]>()
    for (const e of filtered) { if (!m.has(e.date)) m.set(e.date, []); m.get(e.date)!.push(e) }
    return m
  }, [filtered])

  const move = (dir: number) => {
    const d = new Date(cursor)
    if (view === 'week') d.setDate(d.getDate() + dir * 7)
    else d.setMonth(d.getMonth() + dir)
    setCursor(d)
  }

  const openEvent = (e: CalEvent) => { if (e.blogId) { const b = blogById.get(e.blogId); if (b) setOpen(b) } }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button onClick={() => move(-1)} className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronLeft className="h-4 w-4" /></button>
          <button onClick={() => { const d = new Date(); d.setHours(0, 0, 0, 0); setCursor(d) }} className="btn-secondary text-xs">Vandaag</button>
          <button onClick={() => move(1)} className="h-8 w-8 flex items-center justify-center rounded-lg border border-gray-200 hover:bg-gray-50"><ChevronRight className="h-4 w-4" /></button>
          <span className="ml-2 font-semibold text-sm">{view === 'week' ? `Week van ${startOfWeek(cursor).getDate()} ${MONTHS[startOfWeek(cursor).getMonth()]}` : `${MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`}</span>
        </div>
        <div className="flex items-center gap-2">
          <select value={fAccount} onChange={(e) => setFAccount(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"><option value="">Alle projecten</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select>
          <div className="flex items-center gap-1 rounded-lg border border-gray-200 p-0.5">
            {(['maand', 'week', 'lijst'] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`px-3 py-1 text-xs rounded-md capitalize ${view === v ? 'bg-black text-white' : 'text-gray-600 hover:bg-gray-50'}`}>{v}</button>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 text-[11px] text-gray-500">
        {Object.entries(KIND).map(([k, v]) => <span key={k} className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${v.dot}`} />{v.label}</span>)}
      </div>

      {view === 'lijst' ? <ListView byDate={byDate} onOpen={openEvent} /> : view === 'week' ? <WeekView cursor={cursor} byDate={byDate} onOpen={openEvent} /> : <MonthView cursor={cursor} byDate={byDate} onOpen={openEvent} />}

      {open && <BlogEditorModal blog={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

function EventChip({ e, onOpen }: { e: CalEvent; onOpen: (e: CalEvent) => void }) {
  const k = KIND[e.kind]
  const label = e.titel ?? '' // generatie heeft een titel; blog-events tonen titel via lookup elders
  return (
    <button onClick={() => onOpen(e)} className={`block w-full truncate rounded px-1.5 py-0.5 text-left text-[10px] ${k.cls} ${e.blogId ? 'hover:brightness-95 cursor-pointer' : 'cursor-default'}`} title={k.label}>
      {label || k.label}
    </button>
  )
}

function MonthView({ cursor, byDate, onOpen }: { cursor: Date; byDate: Map<string, CalEvent[]>; onOpen: (e: CalEvent) => void }) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const gridStart = startOfWeek(first)
  const todayIso = iso(new Date())
  const cells: Date[] = []
  for (let i = 0; i < 42; i++) { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); cells.push(d) }

  return (
    <div className="rounded-xl border border-gray-200 overflow-hidden">
      <div className="grid grid-cols-7 bg-gray-50 text-[11px] font-medium text-gray-500">
        {DOW.map((d) => <div key={d} className="px-2 py-1.5 text-center">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          const di = iso(d)
          const inMonth = d.getMonth() === cursor.getMonth()
          const evs = byDate.get(di) ?? []
          return (
            <div key={i} className={`min-h-[92px] border-t border-l border-gray-100 p-1.5 ${inMonth ? '' : 'bg-gray-50/50'}`}>
              <div className={`text-[11px] mb-1 ${di === todayIso ? 'font-bold text-black' : inMonth ? 'text-gray-500' : 'text-gray-300'}`}>{di === todayIso ? <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-black text-white">{d.getDate()}</span> : d.getDate()}</div>
              <div className="space-y-0.5">
                {evs.slice(0, 4).map((e, j) => <EventChip key={j} e={e} onOpen={onOpen} />)}
                {evs.length > 4 && <div className="text-[10px] text-gray-400">+{evs.length - 4} meer</div>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function WeekView({ cursor, byDate, onOpen }: { cursor: Date; byDate: Map<string, CalEvent[]>; onOpen: (e: CalEvent) => void }) {
  const start = startOfWeek(cursor)
  const todayIso = iso(new Date())
  const days: Date[] = []
  for (let i = 0; i < 7; i++) { const d = new Date(start); d.setDate(start.getDate() + i); days.push(d) }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
      {days.map((d, i) => {
        const di = iso(d)
        const evs = byDate.get(di) ?? []
        return (
          <div key={i} className="rounded-xl border border-gray-200 p-2 min-h-[120px]">
            <div className={`text-xs mb-1.5 ${di === todayIso ? 'font-bold text-black' : 'text-gray-500'}`}>{DOW[i]} {d.getDate()}</div>
            <div className="space-y-1">
              {evs.map((e, j) => <EventChip key={j} e={e} onOpen={onOpen} />)}
              {evs.length === 0 && <div className="text-[10px] text-gray-300">—</div>}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ListView({ byDate, onOpen }: { byDate: Map<string, CalEvent[]>; onOpen: (e: CalEvent) => void }) {
  const dates = [...byDate.keys()].sort()
  if (dates.length === 0) return <div className="card-base empty-state"><CalendarDays className="h-8 w-8 mx-auto mb-3 opacity-30" /><p className="text-sm">Geen blogactiviteit. Genereer blogs vanuit een blogproject.</p></div>
  return (
    <div className="space-y-2">
      {dates.map((di) => (
        <div key={di} className="card-base">
          <div className="text-xs font-medium text-gray-500 mb-2">{new Date(di).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>
          <div className="space-y-1">
            {(byDate.get(di) ?? []).map((e, j) => {
              const k = KIND[e.kind]
              return (
                <button key={j} onClick={() => onOpen(e)} className={`flex w-full items-center gap-2 text-sm text-left rounded-lg px-2 py-1 ${e.blogId ? 'hover:bg-gray-50 cursor-pointer' : 'cursor-default'}`}>
                  <span className={`status-badge text-[10px] ${k.cls} flex items-center gap-1`}><k.Icon className="h-3 w-3" />{k.label}</span>
                  <span className="text-gray-700 truncate">{e.titel ?? k.label}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

const STATUS_LABEL: Record<string, string> = { klaar_voor_review: 'Te beoordelen', goedgekeurd: 'Goedgekeurd', gepubliceerd: 'Gepubliceerd', gefaald: 'Mislukt' }
const STATUS_CLS: Record<string, string> = { klaar_voor_review: 'bg-amber-100 text-amber-700', goedgekeurd: 'bg-blue-100 text-blue-700', gepubliceerd: 'bg-green-100 text-green-700', gefaald: 'bg-red-100 text-red-700' }

function BlogEditorModal({ blog, onClose }: { blog: CalBlog; onClose: () => void }) {
  const router = useRouter()
  const [f, setF] = useState({ titel: blog.titel, content: blog.content ?? '', meta_title: blog.meta_title ?? '', meta_description: blog.meta_description ?? '', thumbnail_url: blog.thumbnail_url ?? '' })
  const [date, setDate] = useState(blog.publish_at ? blog.publish_at.slice(0, 10) : '')
  const [busy, setBusy] = useState<string | null>(null)

  const call = async (key: string, body: object, okMsg?: string) => {
    setBusy(key)
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const j = await patchJson('/api/admin/blogs', { id: blog.id, ...body }) as any
      if ((body as { action?: string }).action === 'approve') {
        if (j.scheduled) toast.success('Ingepland — wordt automatisch gepubliceerd op de datum.')
        else if (j.concept) toast.success('Als concept bewaard.')
        else if (j.needsConfirm) {
          setBusy(null)
          if (confirm(`${j.warning ?? 'Er staan nog niet-gepubliceerde wijzigingen in Framer.'}\n\nToch publiceren?`)) await call(key, { ...body, confirm_override: true })
          return
        }
        else if (j.published) toast.success('Gepubliceerd op de website.')
        else if (j.pending) toast.message('Goedgekeurd — publicatie gestart.')
        else toast.error(`Publicatie mislukt: ${j.error ?? 'onbekend'}`)
      } else if (okMsg) toast.success(okMsg)
      router.refresh(); onClose()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }

  const save = () => call('save', { ...f }, 'Opgeslagen.')
  const otherImage = async () => {
    setBusy('image')
    try {
      const j = await postJson('/api/admin/blogs', { action: 'image', id: blog.id })
      setF((x) => ({ ...x, thumbnail_url: String(j.url) }))
      toast.success('Nieuwe foto gekozen — klik Opslaan om te bewaren.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }
  const publishNow = () => call('approve', { action: 'approve', publish_mode: 'now' })
  const publishOnDate = () => { if (!date) { toast.error('Kies een publicatiedatum.'); return } call('approve', { action: 'approve', publish_mode: 'scheduled', publish_at: new Date(date).toISOString() }) }
  const keepConcept = () => call('approve', { action: 'approve', publish_mode: 'concept' })
  const regenerate = () => call('regenerate', { action: 'regenerate' }, 'Opnieuw gegenereerd.')
  const del = async () => {
    if (!confirm('Deze blog verwijderen?')) return
    setBusy('del')
    try { const res = await fetch(`/api/admin/blogs?id=${blog.id}`, { method: 'DELETE' }); if (!res.ok) throw new Error((await res.json()).error); toast.success('Verwijderd.'); router.refresh(); onClose() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  const isPublished = blog.status === 'gepubliceerd'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <div className="min-w-0">
            <h3 className="font-semibold truncate flex items-center gap-2"><FileText className="h-4 w-4 text-gray-400 shrink-0" />{blog.account_name}</h3>
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-gray-400">
              <span className={`status-badge text-[10px] ${STATUS_CLS[blog.status] ?? 'bg-gray-100 text-gray-600'}`}>{STATUS_LABEL[blog.status] ?? blog.status}</span>
              {blog.publish_at && blog.status === 'goedgekeurd' && <span className="text-amber-600">gepland {formatDate(blog.publish_at)}</span>}
              {blog.tags?.length ? blog.tags.map((t) => <span key={t} className="status-badge bg-indigo-50 text-indigo-700 text-[10px]">{t}</span>) : null}
            </div>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 shrink-0"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-3">
          {blog.foutmelding && <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">{blog.foutmelding}</div>}
          <div><label className="block text-xs text-gray-600 mb-1">Titel</label><input className={inp} value={f.titel} onChange={(e) => setF((x) => ({ ...x, titel: e.target.value }))} /></div>
          <div><label className="block text-xs text-gray-600 mb-1">Inhoud</label><textarea rows={14} className={`${inp} font-mono text-xs`} value={f.content} onChange={(e) => setF((x) => ({ ...x, content: e.target.value }))} /></div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-600 mb-1">Meta titel</label><input className={inp} value={f.meta_title} onChange={(e) => setF((x) => ({ ...x, meta_title: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">Meta beschrijving</label><input className={inp} value={f.meta_description} onChange={(e) => setF((x) => ({ ...x, meta_description: e.target.value }))} /></div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="block text-xs text-gray-600">Afbeelding (URL)</label>
              <button onClick={otherImage} disabled={!!busy} className="btn-secondary text-[11px]">{busy === 'image' ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}Andere foto</button>
            </div>
            <input className={inp} value={f.thumbnail_url} onChange={(e) => setF((x) => ({ ...x, thumbnail_url: e.target.value }))} placeholder="Automatisch ingevuld; plak hier een eigen foto-URL om te vervangen" />
            {f.thumbnail_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={f.thumbnail_url} alt="" className="mt-2 h-28 w-full object-cover rounded-lg border border-gray-100" />
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <button onClick={save} disabled={!!busy} className="btn-secondary text-sm">{busy === 'save' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Opslaan</button>
            <button onClick={regenerate} disabled={!!busy} className="btn-secondary text-sm">{busy === 'regenerate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Opnieuw genereren</button>
            <button onClick={del} disabled={!!busy} className="btn-secondary text-sm text-red-600 ml-auto">{busy === 'del' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}Verwijderen</button>
          </div>

          <div className="border-t border-gray-100 pt-3 space-y-2">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Publiceren</div>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={publishNow} disabled={!!busy || isPublished} className="btn-primary text-sm">{busy === 'approve' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}Direct publiceren</button>
              <span className="text-xs text-gray-400">of op datum:</span>
              <input type="date" className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs" value={date} onChange={(e) => setDate(e.target.value)} />
              <button onClick={publishOnDate} disabled={!!busy} className="btn-secondary text-sm"><Clock className="h-4 w-4" />Inplannen</button>
              {!isPublished && <button onClick={keepConcept} disabled={!!busy} className="btn-secondary text-sm">Concept houden</button>}
            </div>
            {isPublished && <p className="text-[11px] text-gray-400">Deze blog staat live. Opslaan werkt de website automatisch bij.</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
