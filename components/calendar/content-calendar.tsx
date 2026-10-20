'use client'

import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import {
  ChevronLeft, ChevronRight, X, Check, RefreshCw,
  Send, Pencil, Save, Image, Video, FileText, Plus, MessageSquare,
} from 'lucide-react'
import { ymd } from '@/lib/utils'
import { planningkleur, nuInBrussel, PLANNING_STIJL, type Planningkleur } from '@/lib/content/planning-kleur'
import { KANAAL_SLUGS, kanaalLabel, normaliseerKanalen } from '@/lib/social-platforms'
import {
  magBewerken, magVerwijderen, statusOvergangen, magBeoordelen, overgangLabel, type KalenderRechten,
} from '@/lib/content/kalender-rol'

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
  /** Enkel in de admin geladen (aparte tabel); nooit in het portaal. */
  interne_notitie?: string | null
  /** De klant paste dit item zelf aan in het portaal. */
  klant_gewijzigd_op?: string | null
  klant_gewijzigd_door?: string | null
  /** De klant plande dit item zelf in. */
  klant_aangemaakt_op?: string | null
  /** Tijdstip 'HH:MM' (optioneel). */
  planned_time?: string | null
  published_at?: string | null
  published_url?: string | null
  published_platform?: string | null
}

export type ContentActiviteit = { op: string; door: string | null; rol: 'klant' | 'nextgenmedia'; actie: string; details: Record<string, unknown> | null }

export type CalendarMode = 'admin' | 'client'

const STATUS_STYLE: Record<SocialContentStatus, { dot: string; badge: string; label: string }> = {
  draft: { dot: 'bg-gray-400', badge: 'bg-gray-100 text-gray-600 border-gray-200', label: 'Concept' },
  ready_for_review: { dot: 'bg-amber-400', badge: 'bg-amber-50 text-amber-700 border-amber-200', label: 'Feedback gevraagd' },
  approved: { dot: 'bg-green-500', badge: 'bg-green-50 text-green-700 border-green-200', label: 'Goedgekeurd' },
  changes_requested: { dot: 'bg-red-500', badge: 'bg-red-50 text-red-700 border-red-200', label: 'Aanpassing gevraagd' },
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
  onSetStatus?: (id: string, status: SocialContentStatus, extra?: Record<string, unknown>) => Promise<void>
  /** Activiteit van een item (wie, wanneer, wat) voor het detailpaneel. */
  onLaadActiviteit?: (id: string) => Promise<ContentActiviteit[]>
  onDelete?: (id: string) => Promise<void>
  onCreateOnDay?: (planned_date: string) => void
  onApprove?: (id: string) => Promise<void>
  onRequestChanges?: (id: string, feedback: string) => Promise<void>
  /** Opmerking bij een item (verandert niets aan inhoud of status); geeft de bijgewerkte activiteit terug. */
  onOpmerking?: (id: string, tekst: string) => Promise<ContentActiviteit[]>
}

/** Zonder rechten (zou niet mogen gebeuren in het portaal): enkel kijken. */
const ALLEEN_KIJKEN: KalenderRechten = { rol: 'bekijken', bekijken: true, opmerkingen: false, aanmaken: false, bewerkbaar: [], verwijderen: 'nooit', goedkeuren: [], afkeuren: [], overgangen: {}, startStatussen: [] }
const tijdstip = (iso: string) => new Date(iso).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
const wie = (a: ContentActiviteit) => a.door ?? (a.rol === 'klant' ? 'Klant' : 'NextGenMedia')

export function ContentCalendar({
  items: itemsProp, mode, actions, selection, rechten, focus,
}: {
  items: SocialContentItem[] | null
  mode: CalendarMode
  actions: CalendarActions
  /** Portaal: wat deze klantgebruiker mag (lib/content/kalender-rol.ts). De server controleert hetzelfde. */
  rechten?: KalenderRechten
  /** Een item van buitenaf openen (overzicht "wacht op goedkeuring", link ?item=). `n` verhogen = opnieuw openen. */
  focus?: { id: string; n: number } | null
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
  // Kleuren op status (standaard) of op planning: oranje geplaatst · groen ingepland · wit nog niets. Onthouden per browser.
  const [kleurOp, setKleurOp] = useState<'status' | 'planning'>('status')
  useEffect(() => { try { const v = localStorage.getItem('ngm-kalender-kleur'); if (v === 'planning' || v === 'status') setKleurOp(v) } catch { /* geen opslag */ } }, [])
  const kiesKleur = (v: 'status' | 'planning') => { setKleurOp(v); try { localStorage.setItem('ngm-kalender-kleur', v) } catch { /* geen opslag */ } }
  const nu = useMemo(() => nuInBrussel(), [])
  const selectMode = !!selection?.enabled

  const selected = items.find((i) => i.id === selectedId) ?? null
  const today = ymd(new Date())
  const wortel = useRef<HTMLDivElement>(null)

  // Van buitenaf geopend: naar de maand van het item, het item selecteren en in beeld brengen.
  useEffect(() => {
    if (!focus) return
    const it = items.find((i) => i.id === focus.id)
    if (!it) return
    setView('month')
    setCursor(new Date(`${it.planned_date}T12:00:00`))
    setSelectedId(it.id)
    wortel.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [focus?.id, focus?.n]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (id && actions.onMove) { try { await actions.onMove(id, dayStr) } catch { /* melding komt van de handler */ } }
  }

  return (
    <div ref={wortel} className="flex flex-col gap-4 scroll-mt-20">
      {/* Script panel — on mobile appears ABOVE calendar when an item is selected */}
      {selected && (
        <div className="lg:hidden">
          <ScriptPanel item={selected} mode={mode} actions={actions} rechten={rechten} onClose={() => setSelectedId(null)} />
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
          <div className="flex items-center gap-1 flex-wrap justify-end">
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden mr-1" role="group" aria-label="Kleuren op">
              <span className="text-[11px] text-gray-500 px-2 self-center hidden sm:inline">Kleur</span>
              {(['status', 'planning'] as const).map((k) => (
                <button key={k} type="button" onClick={() => kiesKleur(k)} aria-pressed={kleurOp === k}
                  className={`text-xs px-2.5 py-1.5 border-l border-gray-200 ${kleurOp === k ? 'bg-black text-white' : 'hover:bg-gray-50'}`}>{k === 'status' ? 'Status' : 'Planning'}</button>
              ))}
            </div>
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
            const canAdd = !!actions.onCreateOnDay

            return (
              <div
                key={idx}
                onDragOver={(e) => { if (actions.onMove) e.preventDefault() }}
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
                    const plan: Planningkleur = planningkleur(it, nu)
                    const badge = kleurOp === 'planning' ? PLANNING_STIJL[plan].badge : style.badge
                    const isChecked = selection?.selectedIds.has(it.id) ?? false
                    return (
                      <button
                        key={it.id}
                        draggable={!!actions.onMove && !selectMode}
                        onDragStart={(e) => e.dataTransfer.setData('text/plain', it.id)}
                        onClick={() => {
                          if (selectMode) {
                            selection?.onToggle(it.id)
                          } else {
                            setSelectedId(it.id === selectedId ? null : it.id)
                          }
                        }}
                        className={`text-left text-[11px] px-1.5 py-1 rounded border ${badge}
                          hover:opacity-80 transition truncate flex items-center gap-1 w-full
                          ${isChecked ? 'ring-2 ring-red-400 bg-red-50' : ''}`}
                        title={kleurOp === 'planning' ? `${it.title} · ${PLANNING_STIJL[plan].label} · ${style.label}` : it.title}
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
                        <span className="truncate">{it.planned_time ? <span className="tabular-nums opacity-70">{it.planned_time.slice(0, 5)} </span> : null}{it.title}</span>
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
          {kleurOp === 'planning' ? (
            <>
              {(Object.keys(PLANNING_STIJL) as Planningkleur[]).map((k) => (
                <span key={k} className="flex items-center gap-1.5 text-[11px] text-gray-600">
                  <span className={`h-3 w-5 rounded border ${PLANNING_STIJL[k].badge}`} />
                  {PLANNING_STIJL[k].label}
                </span>
              ))}
              <span className="text-[11px] text-gray-400">· het bolletje blijft de status tonen</span>
            </>
          ) : (Object.entries(STATUS_STYLE) as [SocialContentStatus, typeof STATUS_STYLE[SocialContentStatus]][]).map(([s, v]) => (
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
          rechten={rechten}
          onClose={() => setSelectedId(null)}
        />
      </div>
    </div>
    </div>
  )
}

function ScriptPanel({
  item, mode, actions, rechten, onClose,
}: {
  item: SocialContentItem | null
  mode: CalendarMode
  actions: CalendarActions
  rechten?: KalenderRechten
  onClose: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<SocialContentItem | null>(null)
  const [feedback, setFeedback] = useState('')
  const [opmerking, setOpmerking] = useState('')
  const [busy, setBusy] = useState(false)
  const [publiceer, setPubliceer] = useState<{ datum: string; kanaal: string; link: string } | null>(null)
  const [activiteit, setActiviteit] = useState<ContentActiviteit[] | null>(null)
  const laadActiviteit = actions.onLaadActiviteit
  useEffect(() => {
    setActiviteit(null); setPubliceer(null)
    if (!item || !laadActiviteit) return
    let weg = false
    laadActiviteit(item.id).then((a) => { if (!weg) setActiviteit(a) }).catch(() => { if (!weg) setActiviteit([]) })
    return () => { weg = true }
  }, [item?.id, item?.status, item?.klant_gewijzigd_op, laadActiviteit]) // eslint-disable-line react-hooks/exhaustive-deps

  if (item && form?.id !== item.id) {
    setForm(item)
    setEditing(false)
    setFeedback(item.client_feedback ?? '')
    setOpmerking('')
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
    if (!actions.onUpdate || !form) return
    setBusy(true)
    try {
      const resolvedPlatforms = normaliseerKanalen(
        form.platforms?.length > 0 ? form.platforms : [form.platform],
      )
      await actions.onUpdate(item.id, {
        title: form.title,
        platforms: resolvedPlatforms,
        platform: resolvedPlatforms[0],
        content_type: form.content_type, planned_date: form.planned_date, planned_time: form.planned_time ? form.planned_time.slice(0, 5) : null,
        caption: form.caption, script: form.script, media_notes: form.media_notes,
        // De interne notitie bestaat enkel in de admin; de klant ziet of verstuurt ze nooit.
        ...(isAdmin ? { interne_notitie: form.interne_notitie ?? null } : {}),
      })
      setEditing(false)
    } catch {
      /* melding komt van de handler; bewerkmodus blijft open */
    } finally { setBusy(false) }
  }

  // Opmerkingen en activiteit komen uit hetzelfde logboek; opmerkingen staan apart, oudste eerst.
  const opmerkingen = (activiteit ?? []).filter((a) => a.actie === 'opmerking').reverse()
  const overigeActiviteit = (activiteit ?? []).filter((a) => a.actie !== 'opmerking')
  // Wie zette dit item op zijn huidige status, en wanneer?
  const laatsteStatus = overigeActiviteit.find((a) => a.details && typeof a.details.naar === 'string')
  const statusDoor = laatsteStatus && laatsteStatus.details?.naar === item.status ? laatsteStatus : null
  const plaatsOpmerking = async () => {
    if (!actions.onOpmerking || !opmerking.trim()) return
    setBusy(true)
    try { setActiviteit(await actions.onOpmerking(item.id, opmerking)); setOpmerking('') } catch { /* melding komt van de handler */ } finally { setBusy(false) }
  }
  const zetStatus = async (naar: SocialContentStatus) => {
    setBusy(true)
    try { await actions.onSetStatus?.(item.id, naar) } catch { /* melding komt van de handler */ } finally { setBusy(false) }
  }

  // Portaal: wat mag deze gebruiker bij DIT item (zelfde regels als de server).
  const r = rechten ?? ALLEEN_KIJKEN
  const klantMagBewerken = !isAdmin && !!actions.onUpdate && magBewerken(r, item)
  const klantVergrendeld = !isAdmin && !!actions.onUpdate && !klantMagBewerken
  const klantGoedkeuren = !isAdmin && !!actions.onApprove && magBeoordelen(r, item.status, 'approved')
  const klantAfkeuren = !isAdmin && !!actions.onRequestChanges && magBeoordelen(r, item.status, 'changes_requested')
  const klantPlanning = !isAdmin && actions.onSetStatus ? statusOvergangen(r, item.status) : []
  const klantVerwijderen = !isAdmin && !!actions.onDelete && magVerwijderen(r, item)
  const klantNiets = !klantMagBewerken && !klantGoedkeuren && !klantAfkeuren && klantPlanning.length === 0 && !klantVerwijderen
  const toonActies = isAdmin || editing || !klantNiets || klantVergrendeld || !actions.onOpmerking

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
            <span className="text-xs text-gray-400">{f.planned_date}{f.planned_time ? ` · ${f.planned_time.slice(0, 5)}` : ''}</span>
          </div>
          {statusDoor && (
            <p className="text-[11px] text-gray-400 -mt-1 mb-2">Op “{style.label}” gezet door {wie(statusDoor)}{statusDoor.rol === 'klant' ? ' (klant)' : ''} · {tijdstip(statusDoor.op)}</p>
          )}
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
                <span className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Tijdstip <span className="normal-case text-gray-400">(optioneel)</span></span>
                <input type="time" className={inp} value={(f.planned_time ?? '').slice(0, 5)} onChange={(e) => setForm({ ...f, planned_time: e.target.value || null })} />
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

        {item.status === 'published' && (item.published_at || item.published_url || item.published_platform) && (
          <div className="rounded-lg border border-purple-200 bg-purple-50 p-2.5 text-sm text-purple-900">
            <div className="text-[10px] uppercase tracking-wide mb-0.5">Gepubliceerd</div>
            {item.published_at && <div>{new Date(item.published_at).toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels' })}{item.published_platform ? ` · ${kanaalLabel(item.published_platform)}` : ''}</div>}
            {item.published_url && <a href={item.published_url} target="_blank" rel="noopener noreferrer" className="underline break-all">{item.published_url}</a>}
          </div>
        )}

        {isAdmin && (editing || f.interne_notitie) && (
          <div className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-2.5">
            <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Interne notitie <span className="normal-case">— enkel zichtbaar voor NextGenMedia</span></div>
            {editing ? (
              <textarea rows={2} value={f.interne_notitie ?? ''} onChange={(e) => setForm({ ...f, interne_notitie: e.target.value })} className={inp} />
            ) : (
              <p className="text-sm whitespace-pre-wrap text-gray-700">{f.interne_notitie}</p>
            )}
          </div>
        )}

        {isAdmin && item.klant_gewijzigd_op && (
          <p className="text-[11px] text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-1.5">Aangepast door de klant{item.klant_gewijzigd_door ? ` (${item.klant_gewijzigd_door})` : ''} op {new Date(item.klant_gewijzigd_op).toLocaleString('nl-BE', { timeZone: 'Europe/Brussels', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
        )}

        {laadActiviteit && (opmerkingen.length > 0 || actions.onOpmerking) && (
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Opmerkingen</div>
            {activiteit === null ? <p className="text-xs text-gray-400">Laden…</p> : opmerkingen.length === 0 ? <p className="text-xs text-gray-400">Nog geen opmerkingen.</p> : (
              <ul className="space-y-1.5">
                {opmerkingen.map((o, i) => (
                  <li key={i} className={`rounded-lg border px-2.5 py-1.5 ${o.rol === 'klant' ? 'border-amber-100 bg-amber-50/60' : 'border-gray-100 bg-gray-50'}`}>
                    <div className="text-[11px] text-gray-500"><b className="font-medium text-gray-800">{wie(o)}</b>{o.rol === 'klant' ? ' (klant)' : ' (NextGenMedia)'} · <span className="tabular-nums">{tijdstip(o.op)}</span></div>
                    <p className="text-sm text-gray-800 whitespace-pre-wrap break-words">{String(o.details?.tekst ?? '')}</p>
                  </li>
                ))}
              </ul>
            )}
            {actions.onOpmerking && (
              <div className="mt-2 space-y-1.5">
                <textarea rows={2} maxLength={2000} value={opmerking} onChange={(e) => setOpmerking(e.target.value)} className={inp} placeholder="Schrijf een opmerking…" aria-label="Opmerking" />
                <button type="button" disabled={busy || !opmerking.trim()} onClick={plaatsOpmerking} className="btn-secondary text-xs w-full">
                  <MessageSquare className="h-3 w-3" />
                  Opmerking plaatsen
                </button>
              </div>
            )}
          </div>
        )}

        {laadActiviteit && (
          <div>
            <div className="text-[10px] text-gray-500 uppercase tracking-wide mb-1">Activiteit</div>
            {activiteit === null ? <p className="text-xs text-gray-400">Laden…</p> : overigeActiviteit.length === 0 ? <p className="text-xs text-gray-400">Nog geen activiteit geregistreerd.</p> : (
              <ul className="space-y-1">
                {overigeActiviteit.slice(0, 12).map((a, i) => (
                  <li key={i} className="text-xs text-gray-600 flex gap-2">
                    <span className="tabular-nums text-gray-400 shrink-0">{tijdstip(a.op)}</span>
                    <span><b className="font-medium text-gray-800">{wie(a)}</b>{a.rol === 'klant' ? ' (klant)' : ''} {a.actie}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {item.status === 'changes_requested' && item.client_feedback && (
          <div className="text-sm rounded-lg border border-red-200 bg-red-50 p-3 text-red-700">
            <strong className="block mb-1 text-xs uppercase tracking-wide">Gevraagde aanpassing</strong>
            {item.client_feedback}
          </div>
        )}
      </div>

      {/* Actions */}
      {toonActies && (
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
              {item.status === 'ready_for_review' && (
                <>
                  <button disabled={busy} onClick={() => zetStatus('approved')} className="btn-secondary text-xs flex-1">
                    <Check className="h-3 w-3" />
                    Goedkeuren
                  </button>
                  <button disabled={busy} onClick={() => zetStatus('draft')} className="btn-secondary text-xs">
                    Terug naar concept
                  </button>
                </>
              )}
              {(item.status === 'draft' || item.status === 'changes_requested') && (
                <button
                  disabled={busy}
                  onClick={async () => { setBusy(true); try { await actions.onSetStatus?.(item.id, 'ready_for_review') } catch { /* melding komt van de handler */ } finally { setBusy(false) } }}
                  className="btn-secondary text-xs flex-1"
                >
                  <Send className="h-3 w-3" />
                  Naar klant
                </button>
              )}
              {item.status === 'approved' && (
                <button
                  disabled={busy}
                  onClick={async () => { setBusy(true); try { await actions.onSetStatus?.(item.id, 'scheduled') } catch { /* melding komt van de handler */ } finally { setBusy(false) } }}
                  className="btn-secondary text-xs"
                >
                  Inplannen
                </button>
              )}
              {item.status === 'scheduled' && (
                <button
                  disabled={busy}
                  onClick={async () => { setBusy(true); try { await actions.onSetStatus?.(item.id, 'published') } catch { /* melding komt van de handler */ } finally { setBusy(false) } }}
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
                    try { await actions.onDelete!(item.id); onClose() } catch { /* melding komt van de handler */ } finally { setBusy(false) }
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
            {klantMagBewerken && (
              editing ? (
                <div className="flex gap-2">
                  <button disabled={busy} onClick={save} className="btn-primary flex-1">
                    {busy ? <span className="h-4 w-4 border-2 border-black/20 border-t-black rounded-full animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                    Opslaan
                  </button>
                  <button onClick={() => { setForm(item); setEditing(false) }} className="btn-secondary">Annuleer</button>
                </div>
              ) : (
                <button onClick={() => setEditing(true)} className="btn-secondary w-full">
                  <Pencil className="h-3.5 w-3.5" />
                  Zelf aanpassen
                </button>
              )
            )}
            {!editing && klantVergrendeld && (
              <p className="text-[11px] text-gray-500">Een item met status “{style.label}” kan je niet meer aanpassen.{actions.onOpmerking ? ' Plaats een opmerking als er iets moet veranderen.' : ''}</p>
            )}
            {!editing && (klantGoedkeuren || klantAfkeuren) && (
              <div className="space-y-3">
                {klantAfkeuren && (
                  <div>
                    <label className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">
                      Wat moet er anders?
                    </label>
                    <textarea
                      rows={3}
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      className={inp}
                      placeholder="Beschrijf de aanpassing die je wil"
                    />
                  </div>
                )}
                <div className="flex gap-2">
                  {klantAfkeuren && (
                    <button
                      disabled={busy || !feedback.trim()}
                      onClick={async () => { setBusy(true); try { await actions.onRequestChanges!(item.id, feedback) } catch { /* melding komt van de handler */ } finally { setBusy(false) } }}
                      className="btn-secondary flex-1 text-xs"
                    >
                      <RefreshCw className="h-3 w-3" />
                      Aanpassing vragen
                    </button>
                  )}
                  {klantGoedkeuren && (
                    <button
                      disabled={busy}
                      onClick={async () => { setBusy(true); try { await actions.onApprove!(item.id) } catch { /* melding komt van de handler */ } finally { setBusy(false) } }}
                      className="btn-primary flex-1 text-xs"
                    >
                      <Check className="h-3 w-3" />
                      Goedkeuren
                    </button>
                  )}
                </div>
              </div>
            )}
            {!editing && klantPlanning.length > 0 && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {klantPlanning.map((naar) => (
                    <button key={naar} type="button" disabled={busy}
                      onClick={async () => {
                        if (naar === 'published') { setPubliceer({ datum: new Date().toISOString().slice(0, 10), kanaal: normaliseerKanalen(item.platforms?.length ? item.platforms : [item.platform])[0] ?? '', link: '' }); return }
                        await zetStatus(naar)
                      }}
                      className={naar === 'published' || naar === 'ready_for_review' ? 'btn-primary text-xs flex-1' : 'btn-secondary text-xs flex-1'}>
                      {naar === 'ready_for_review' && <Send className="h-3 w-3" />}
                      {overgangLabel(item.status, naar)}
                    </button>
                  ))}
                </div>
                {publiceer && (
                  <div className="rounded-lg border border-gray-200 p-2.5 space-y-2">
                    <p className="text-[11px] text-gray-500">Enkel de status in de kalender — er wordt niets op sociale media geplaatst.</p>
                    <div className="grid grid-cols-2 gap-2">
                      <label><span className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Publicatiedatum</span><input type="date" className={inp} max={new Date().toISOString().slice(0, 10)} value={publiceer.datum} onChange={(e) => setPubliceer({ ...publiceer, datum: e.target.value })} /></label>
                      <label><span className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Kanaal</span><select className={inp} value={publiceer.kanaal} onChange={(e) => setPubliceer({ ...publiceer, kanaal: e.target.value })}>{normaliseerKanalen(item.platforms?.length ? item.platforms : [item.platform]).map((k) => <option key={k} value={k}>{kanaalLabel(k)}</option>)}</select></label>
                    </div>
                    <label className="block"><span className="block text-[10px] text-gray-500 uppercase tracking-wide mb-1">Link naar de post <span className="normal-case text-gray-400">(optioneel)</span></span><input type="url" className={inp} value={publiceer.link} onChange={(e) => setPubliceer({ ...publiceer, link: e.target.value })} placeholder="https://" /></label>
                    <div className="flex gap-2">
                      <button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await actions.onSetStatus!(item.id, 'published', { published_at: publiceer.datum, published_platform: publiceer.kanaal || null, published_url: publiceer.link || null }); setPubliceer(null) } catch { /* melding komt van de handler */ } finally { setBusy(false) } }} className="btn-primary text-xs flex-1">Bevestigen</button>
                      <button type="button" onClick={() => setPubliceer(null)} className="btn-secondary text-xs">Annuleer</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {!editing && klantVerwijderen && (
              <button
                disabled={busy}
                onClick={async () => {
                  if (!confirm(`“${item.title}” definitief verwijderen? Dit kan niet ongedaan gemaakt worden.`)) return
                  setBusy(true)
                  try { await actions.onDelete!(item.id); onClose() } catch { /* melding komt van de handler */ } finally { setBusy(false) }
                }}
                className="btn-secondary text-xs w-full text-red-700"
              >
                Verwijderen
              </button>
            )}
            {!editing && klantNiets && !klantVergrendeld && !actions.onOpmerking && (
              <p className="text-xs text-gray-400 text-center">Geen actie vereist op dit moment.</p>
            )}
          </>
        )}
      </div>
      )}
    </aside>
  )
}
