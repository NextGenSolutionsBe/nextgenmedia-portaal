'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  ChevronLeft, ChevronRight, Loader2, X, Calendar, Clock, ExternalLink,
  Image as ImageIcon, Video,
} from 'lucide-react'
import { ymd } from '@/lib/utils'

export type MetricoolMedia = { type: 'image' | 'video' | 'other'; url: string; thumbnail?: string | null }
export type MetricoolCalPost = {
  id: string; blogId: string; datetime: string | null; networks: string[]
  text: string; status: string; media: MetricoolMedia[]; permalink?: string | null
  clientId: string; clientName: string
}

const WEEKDAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']
const PALETTE = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#4f46e5', '#ca8a04', '#0d9488']
export function colorFor(clientId: string): string {
  let h = 0
  for (let i = 0; i < clientId.length; i++) h = (h * 31 + clientId.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

function startOfMonthGrid(d: Date): Date {
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const dow = (first.getDay() + 6) % 7
  return new Date(first.getFullYear(), first.getMonth(), 1 - dow)
}
// Datum/tijd komen als naïeve Brusselse wall-clock strings ("YYYY-MM-DDTHH:mm:ss").
// We renderen ze zuiver uit de string-componenten → geen tijdzone-verschuiving,
// ongeacht de tijdzone van de kijker.
export function timeLabel(dt: string | null): string {
  if (!dt) return ''
  const m = dt.match(/T(\d{2}):(\d{2})/)
  return m ? `${m[1]}:${m[2]}` : ''
}
function dayKeyOf(dt: string): string { return dt.slice(0, 10) }
function longDateOf(dt: string): string {
  const [y, mo, d] = dt.slice(0, 10).split('-').map(Number)
  if (!y || !mo || !d) return dt.slice(0, 10)
  return new Date(y, mo - 1, d, 12).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })
}
function fullDateTimeOf(dt: string): string {
  const [y, mo, d] = dt.slice(0, 10).split('-').map(Number)
  if (!y || !mo || !d) return dt
  const label = new Date(y, mo - 1, d, 12).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' })
  return `${label} ${timeLabel(dt)}`
}
function brusselsToday(): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? ''
  return `${g('year')}-${g('month')}-${g('day')}`
}
function brusselsNowNaive(): string {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(new Date())
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? '00'
  const h = g('hour') === '24' ? '00' : g('hour')
  return `${g('year')}-${g('month')}-${g('day')}T${h}:${g('minute')}:${g('second')}`
}

const STATUS_STYLE: Record<string, string> = {
  published: 'bg-green-50 text-green-700 border-green-200',
  scheduled: 'bg-blue-50 text-blue-700 border-blue-200',
  draft: 'bg-gray-100 text-gray-600 border-gray-200',
  error: 'bg-red-50 text-red-700 border-red-200',
}
const STATUS_LABEL: Record<string, string> = {
  published: 'Gepubliceerd', scheduled: 'Ingepland', draft: 'Concept', error: 'Fout',
}

/**
 * Gedeelde read-only Metricool-kalender. Admin gebruikt 'm met meerdere klanten
 * (kleuren + klantnaam), het klantportaal met één klant. De ouder levert de
 * posts en haalt nieuwe op wanneer de zichtbare maand wijzigt (onRangeChange).
 */
export function MetricoolCalendarView({
  posts, loading, onRangeChange, showClientName = true, colorMode = 'client',
}: {
  posts: MetricoolCalPost[]
  loading: boolean
  onRangeChange: (startYmd: string, endYmd: string) => void
  showClientName?: boolean
  colorMode?: 'client' | 'accent'
}) {
  const [cursor, setCursor] = useState(() => new Date())
  const [selected, setSelected] = useState<MetricoolCalPost | null>(null)
  const [dayModal, setDayModal] = useState<{ key: string; items: MetricoolCalPost[] } | null>(null)

  useEffect(() => {
    const start = ymd(new Date(cursor.getFullYear(), cursor.getMonth(), 1))
    const end = ymd(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0))
    onRangeChange(start, end)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor])

  const dot = (p: MetricoolCalPost) => (colorMode === 'accent' ? '#c5b800' : colorFor(p.clientId))

  const byDay = useMemo(() => {
    const m = new Map<string, MetricoolCalPost[]>()
    for (const p of posts) {
      if (!p.datetime) continue
      const key = dayKeyOf(p.datetime)
      const list = m.get(key) ?? []
      list.push(p); m.set(key, list)
    }
    for (const list of m.values()) list.sort((a, b) => (a.datetime ?? '').localeCompare(b.datetime ?? ''))
    return m
  }, [posts])

  const nextPost = useMemo(() => {
    const now = brusselsNowNaive()
    return posts.filter((p) => p.datetime && p.datetime >= now)
      .sort((a, b) => (a.datetime ?? '').localeCompare(b.datetime ?? ''))[0] ?? null
  }, [posts])

  const days = useMemo(() => {
    const start = startOfMonthGrid(cursor)
    return Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d })
  }, [cursor])

  const title = cursor.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' })
  const today = brusselsToday()

  return (
    <div className="space-y-4">
      {nextPost && (
        <div className="card-base flex items-center gap-3 flex-wrap">
          <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: dot(nextPost) }} />
          <div className="text-sm">
            <span className="text-gray-500">Volgende post:</span>{' '}
            {showClientName && <><b>{nextPost.clientName}</b> — </>}
            {nextPost.datetime && longDateOf(nextPost.datetime)}
            {' '}om <b>{timeLabel(nextPost.datetime)}</b>
            {nextPost.networks.length > 0 && <span className="text-gray-400"> · {nextPost.networks.join(', ')}</span>}
          </div>
          <button onClick={() => setSelected(nextPost)} className="ml-auto text-xs text-gray-500 hover:text-black">Bekijk →</button>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
          <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100">
            <div className="flex items-center gap-1">
              <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100"><ChevronLeft className="h-4 w-4" /></button>
              <button onClick={() => setCursor(new Date())} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">Vandaag</button>
              <button onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100"><ChevronRight className="h-4 w-4" /></button>
              <span className="ml-2 font-semibold capitalize text-sm">{title}</span>
            </div>
            {loading && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
          </div>

          <div className="grid grid-cols-7 border-b border-gray-100">
            {WEEKDAYS.map((w) => <div key={w} className="text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wider py-2">{w}</div>)}
          </div>

          <div className="grid grid-cols-7 grid-rows-6">
            {days.map((d, idx) => {
              const dayStr = ymd(d)
              const inMonth = d.getMonth() === cursor.getMonth()
              const isToday = dayStr === today
              const items = byDay.get(dayStr) ?? []
              return (
                <div key={idx} className={`relative border-r border-b border-gray-100 p-1.5 flex flex-col gap-1 min-h-[104px] ${!inMonth ? 'bg-gray-50/50' : ''}`}>
                  <button
                    type="button"
                    onClick={() => items.length > 0 && setDayModal({ key: dayStr, items })}
                    disabled={items.length === 0}
                    className={`text-[11px] font-medium px-1 py-0.5 rounded-full self-start ${isToday ? 'bg-[#fff848] text-black font-bold' : inMonth ? 'text-gray-700' : 'text-gray-300'} ${items.length > 0 ? 'hover:ring-1 hover:ring-gray-300 cursor-pointer' : ''}`}
                    title={items.length > 0 ? `${items.length} post(s) — bekijk alles` : undefined}
                  >{d.getDate()}</button>
                  <div className="flex flex-col gap-0.5 overflow-hidden">
                    {items.slice(0, 4).map((p) => (
                      <button key={p.id} onClick={() => setSelected(p)} title={`${showClientName ? p.clientName + ' · ' : ''}${timeLabel(p.datetime)}`}
                        className="text-left text-[11px] px-1.5 py-1 rounded border bg-white hover:bg-gray-50 transition truncate flex items-center gap-1 w-full"
                        style={{ borderColor: dot(p) }}>
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: dot(p) }} />
                        <span className="tabular-nums text-gray-500 shrink-0">{timeLabel(p.datetime)}</span>
                        <span className="truncate">{showClientName ? p.clientName : (p.networks[0] ?? 'post')}</span>
                      </button>
                    ))}
                    {items.length > 4 && (
                      <button
                        type="button"
                        onClick={() => setDayModal({ key: dayStr, items })}
                        className="text-[10px] text-gray-500 hover:text-black font-medium px-1 text-left hover:underline"
                      >+{items.length - 4} meer</button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="lg:w-[380px]">
          <PreviewPanel post={selected} showClientName={showClientName} onClose={() => setSelected(null)} />
        </div>
      </div>

      {dayModal && (
        <DayModal
          dayKey={dayModal.key}
          items={dayModal.items}
          showClientName={showClientName}
          dot={dot}
          onPick={(p) => { setSelected(p); setDayModal(null) }}
          onClose={() => setDayModal(null)}
        />
      )}
    </div>
  )
}

function DayModal({
  dayKey, items, showClientName, dot, onPick, onClose,
}: {
  dayKey: string
  items: MetricoolCalPost[]
  showClientName: boolean
  dot: (p: MetricoolCalPost) => string
  onPick: (p: MetricoolCalPost) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85dvh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2">
            <Calendar className="h-5 w-5 text-gray-700" />
            <span className="capitalize">{longDateOf(`${dayKey}T12:00:00`)}</span>
            <span className="text-xs font-normal text-gray-400">· {items.length} post(s)</span>
          </h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-3 overflow-y-auto space-y-1.5">
          {items.map((p) => {
            const thumb = p.media.find((m) => m.type === 'image')?.url ?? p.media.find((m) => m.type === 'video')?.thumbnail ?? null
            return (
              <button key={p.id} onClick={() => onPick(p)}
                className="w-full text-left flex items-center gap-3 p-2 rounded-xl border border-gray-100 hover:border-gray-200 hover:bg-gray-50 transition">
                <span className="tabular-nums text-sm font-semibold text-gray-700 w-12 shrink-0">{timeLabel(p.datetime)}</span>
                <span className="h-10 w-10 rounded-lg bg-gray-100 overflow-hidden shrink-0 flex items-center justify-center" style={{ boxShadow: `inset 0 0 0 2px ${dot(p)}` }}>
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageIcon className="h-4 w-4 text-gray-300" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  {showClientName && <span className="block text-sm font-medium text-gray-900 truncate">{p.clientName}</span>}
                  <span className="block text-xs text-gray-500 truncate">{p.text || '(geen tekst)'}</span>
                  {p.networks.length > 0 && <span className="block text-[10px] text-gray-400 capitalize mt-0.5">{p.networks.join(', ')}</span>}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function PreviewPanel({ post, showClientName, onClose }: { post: MetricoolCalPost | null; showClientName: boolean; onClose: () => void }) {
  if (!post) {
    return (
      <aside className="w-full bg-white border border-gray-200 rounded-xl p-5 h-fit shadow-sm">
        <div className="text-center py-8"><Calendar className="h-8 w-8 text-gray-200 mx-auto mb-3" /><p className="text-sm text-gray-400">Klik op een post voor de preview</p></div>
      </aside>
    )
  }
  const style = STATUS_STYLE[post.status] ?? 'bg-gray-100 text-gray-600 border-gray-200'
  return (
    <aside className="w-full bg-white border border-gray-200 rounded-xl shadow-sm h-fit lg:sticky lg:top-6 max-h-[80vh] flex flex-col overflow-hidden">
      <div className="p-4 border-b border-gray-100 flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`status-badge border ${style}`}>{STATUS_LABEL[post.status] ?? post.status}</span>
            {post.networks.map((n) => <span key={n} className="capitalize bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded text-[10px]">{n}</span>)}
          </div>
          {showClientName && <h3 className="font-semibold text-gray-900 leading-snug">{post.clientName}</h3>}
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {post.datetime ? fullDateTimeOf(post.datetime) : 'Geen tijd'}
          </div>
        </div>
        <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 shrink-0"><X className="h-4 w-4" /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {post.media.length > 0 ? (
          <div className="space-y-2">
            {post.media.map((m, i) => (
              <div key={i} className="rounded-lg overflow-hidden border border-gray-100 bg-gray-50">
                {m.type === 'video' ? (
                  <video src={m.url} controls playsInline className="w-full max-h-[320px] bg-black" poster={m.thumbnail ?? undefined} />
                ) : m.type === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.url} alt="preview" className="w-full object-cover max-h-[320px]" />
                ) : (
                  <a href={m.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 p-3 text-sm text-blue-600 hover:underline"><ExternalLink className="h-4 w-4" />Media openen</a>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-gray-200 p-6 text-center text-gray-400 text-sm flex flex-col items-center gap-2">
            <span className="flex gap-1"><ImageIcon className="h-5 w-5" /><Video className="h-5 w-5" /></span>
            Geen media-preview beschikbaar
          </div>
        )}

        {post.text && (
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Tekst</div>
            <p className="text-sm whitespace-pre-wrap text-gray-700 leading-relaxed">{post.text}</p>
          </div>
        )}
      </div>

      {post.permalink && (
        <div className="p-4 border-t border-gray-100">
          <a href={post.permalink} target="_blank" rel="noreferrer" className="btn-secondary w-full text-sm justify-center"><ExternalLink className="h-4 w-4" />Open in Metricool</a>
        </div>
      )}
    </aside>
  )
}
