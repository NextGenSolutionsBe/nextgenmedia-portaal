'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, CalendarDays, RotateCcw, X, Check, Pencil, Loader2 } from 'lucide-react'

// Interne visuele maandplanning voor NextGenMedia. Standaard automatisch op basis
// van werkdagen (ma–vr), herberekend vanaf de eerste werkdag van de maand. Admin
// kan per dag de fases verslepen / aanpassen; "Reset maand" zet alles terug.

type CatKey = 'ideeen' | 'intakes' | 'scripts' | 'shoots' | 'edit' | 'feedback' | 'aanpassingen' | 'stats'

const CATS: Record<CatKey, { label: string; short: string; desc: string; dot: string; chip: string; summary: string }> = {
  ideeen: {
    label: 'Contentkalender & Scripts', short: 'Kalender & Scripts',
    desc: 'Contentkalender invullen, contentideeën bepalen, scripts uitschrijven',
    dot: 'bg-yellow-400', chip: 'bg-yellow-100 text-yellow-800 border-yellow-300', summary: 'kalenderdagen',
  },
  intakes: {
    label: 'Intakes & Meetings', short: 'Intakes', desc: 'Intakes, onboarding, meetings, statistieken bespreken',
    dot: 'bg-blue-500', chip: 'bg-blue-100 text-blue-700 border-blue-200', summary: 'intakedagen',
  },
  scripts: {
    label: 'Aanpassingen', short: 'Aanpass.',
    desc: 'Aanpassingen contentkalender verwerken, aanpassingen scripts verwerken, shootbriefing voorbereiden',
    dot: 'bg-teal-500', chip: 'bg-teal-100 text-teal-700 border-teal-200', summary: 'aanpassingsdagen',
  },
  shoots: {
    label: 'Contentshoots', short: 'Shoot', desc: 'Contentshoots',
    dot: 'bg-purple-500', chip: 'bg-purple-100 text-purple-700 border-purple-200', summary: 'shootdagen',
  },
  edit: {
    label: 'Editen & Inplannen', short: 'Edit', desc: 'Editen + content inplannen in Metricool',
    dot: 'bg-green-500', chip: 'bg-green-100 text-green-700 border-green-200', summary: 'editdagen',
  },
  feedback: {
    label: 'Klantfeedback', short: 'Feedback', desc: 'Klanten kunnen feedback geven',
    dot: 'bg-orange-500', chip: 'bg-orange-100 text-orange-700 border-orange-200', summary: 'feedbackdagen',
  },
  aanpassingen: {
    label: 'Aanpassingen verwerken', short: 'Verwerken', desc: 'Klantaanpassingen verwerken',
    dot: 'bg-red-500', chip: 'bg-red-100 text-red-700 border-red-200', summary: 'verwerkingsdagen',
  },
  stats: {
    label: 'Statistieken', short: 'Stats', desc: 'Statistieken vorige maand versturen',
    dot: 'bg-gray-900', chip: 'bg-gray-900 text-white border-gray-900', summary: 'statistiekendag',
  },
}

const ORDER: CatKey[] = ['ideeen', 'intakes', 'scripts', 'shoots', 'edit', 'feedback', 'aanpassingen', 'stats']
const WEEKDAYS = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']

/** Standaard-categorieën voor werkdag-index i (1-based) van `total` werkdagen. */
function defaultForWorkday(i: number, total: number): CatKey[] {
  const c: CatKey[] = []
  if (i >= 1 && i <= 2) c.push('ideeen')          // contentideeën + kalender invullen
  if (i >= 3 && i <= 5) c.push('intakes')
  if (i >= 6 && i <= 8) c.push('scripts')         // scripts maken / aanpassen
  if (i >= 6 && i <= 13) c.push('shoots')
  if (i >= 11 && i <= 18) c.push('edit')
  if (i >= 19 && i <= 21) c.push('feedback')
  if (i >= 19 && i <= 22) c.push('aanpassingen')
  if (i === total) c.push('stats')
  return c
}

const isWeekday = (d: Date) => d.getDay() !== 0 && d.getDay() !== 6
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
function startOfMonthGrid(d: Date): Date {
  const first = new Date(d.getFullYear(), d.getMonth(), 1)
  const dow = (first.getDay() + 6) % 7
  return new Date(first.getFullYear(), first.getMonth(), 1 - dow)
}

export function MaandplanningCalendar() {
  const [cursor, setCursor] = useState(() => new Date())
  const [overrides, setOverrides] = useState<Record<string, CatKey[]>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dragFrom, setDragFrom] = useState<string | null>(null)

  const y = cursor.getFullYear(); const m = cursor.getMonth()
  const monthFrom = useMemo(() => ymd(new Date(y, m, 1)), [y, m])
  const monthTo = useMemo(() => ymd(new Date(y, m + 1, 0)), [y, m])

  // Standaard werkdag-index per datum
  const defaults = useMemo(() => {
    const map = new Map<string, CatKey[]>()
    const workdays: Date[] = []
    const d = new Date(y, m, 1)
    while (d.getMonth() === m) { if (isWeekday(d)) workdays.push(new Date(d)); d.setDate(d.getDate() + 1) }
    workdays.forEach((day, idx) => map.set(ymd(day), defaultForWorkday(idx + 1, workdays.length)))
    return map
  }, [y, m])

  const loadOverrides = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/month-planning?from=${monthFrom}&to=${monthTo}`)
      const json = await res.json()
      if (res.ok) {
        const map: Record<string, CatKey[]> = {}
        for (const o of (json.overrides ?? []) as Array<{ plan_date: string; categories: string[] }>) {
          map[o.plan_date.slice(0, 10)] = (o.categories as CatKey[])
        }
        setOverrides(map)
      }
    } catch { /* stil — val terug op standaard */ }
  }, [monthFrom, monthTo])

  useEffect(() => { setOverrides({}); setEditing(null); loadOverrides() }, [loadOverrides])

  const effective = useCallback((dateStr: string, inMonth: boolean, weekday: boolean): CatKey[] => {
    if (dateStr in overrides) return overrides[dateStr]
    if (inMonth && weekday) return defaults.get(dateStr) ?? []
    return []
  }, [overrides, defaults])

  const days = useMemo(() => {
    const start = startOfMonthGrid(cursor)
    return Array.from({ length: 42 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return x })
  }, [cursor])

  // Samenvatting over alle dagen in de maand
  const counts = useMemo(() => {
    const c: Record<CatKey, number> = { ideeen: 0, intakes: 0, scripts: 0, shoots: 0, edit: 0, feedback: 0, aanpassingen: 0, stats: 0 }
    for (const d of days) {
      if (d.getMonth() !== m) continue
      for (const k of effective(ymd(d), true, isWeekday(d))) c[k]++
    }
    return c
  }, [days, m, effective])

  const title = cursor.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' })
  const navigate = (delta: number) => setCursor(new Date(y, m + delta, 1))
  const todayStr = ymd(new Date())

  const putOverride = async (dateStr: string, cats: CatKey[]) => {
    await fetch('/api/admin/month-planning', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan_date: dateStr, categories: cats }),
    })
  }

  const onDrop = async (toDate: string, inMonth: boolean) => {
    const from = dragFrom; setDragFrom(null)
    if (!from || !inMonth || from === toDate) return
    const fromCats = effective(from, true, true)
    setOverrides((o) => ({ ...o, [toDate]: fromCats, [from]: [] }))
    setBusy(true)
    try { await putOverride(toDate, fromCats); await putOverride(from, []) } finally { setBusy(false) }
  }

  const saveEdit = async (dateStr: string, cats: CatKey[]) => {
    setOverrides((o) => ({ ...o, [dateStr]: cats }))
    setEditing(null); setBusy(true)
    try { await putOverride(dateStr, cats) } finally { setBusy(false) }
  }

  const resetMonth = async () => {
    if (!confirm('Alle handmatige aanpassingen van deze maand terugzetten naar de standaardplanning?')) return
    setBusy(true)
    try {
      await fetch(`/api/admin/month-planning?from=${monthFrom}&to=${monthTo}`, { method: 'DELETE' })
      setOverrides({})
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Maandplanning</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Automatisch per werkdag — sleep een dag of klik om handmatig aan te passen
          </p>
        </div>
        <button onClick={resetMonth} disabled={busy} className="btn-secondary text-sm">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          Reset maand
        </button>
      </div>

      {/* Samenvatting */}
      <div className="card-base">
        <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mb-3">Deze maand</div>
        <div className="flex flex-wrap gap-2">
          {ORDER.map((k) => (
            <span key={k} className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border text-xs font-medium ${CATS[k].chip}`}>
              <span className="font-bold">{counts[k]}</span> {CATS[k].summary}
            </span>
          ))}
        </div>
      </div>

      {/* Kalender */}
      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 flex-wrap">
          <div className="flex items-center gap-1">
            <button onClick={() => navigate(-1)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Vorige maand"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => setCursor(new Date())} className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">Deze maand</button>
            <button onClick={() => navigate(1)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Volgende maand"><ChevronRight className="h-4 w-4" /></button>
            <span className="ml-2 font-semibold capitalize text-sm flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-gray-400" />{title}</span>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-gray-100">
          {WEEKDAYS.map((w) => <div key={w} className="text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wider py-2">{w}</div>)}
        </div>

        <div className="grid grid-cols-7 grid-rows-6">
          {days.map((d, idx) => {
            const dateStr = ymd(d)
            const inMonth = d.getMonth() === m
            const weekday = isWeekday(d)
            const cats = effective(dateStr, inMonth, weekday)
            const isToday = dateStr === todayStr
            return (
              <div
                key={idx}
                draggable={inMonth && cats.length > 0}
                onDragStart={() => setDragFrom(dateStr)}
                onDragOver={(e) => { if (inMonth) e.preventDefault() }}
                onDrop={() => onDrop(dateStr, inMonth)}
                onClick={() => { if (inMonth) setEditing(dateStr) }}
                className={`group relative border-r border-b border-gray-100 p-1.5 min-h-[88px] flex flex-col gap-1
                  ${!inMonth ? 'bg-gray-50/40' : !weekday ? 'bg-gray-50/70' : 'cursor-pointer hover:bg-yellow-50/30'}
                  ${dragFrom === dateStr ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-[11px] font-medium px-1 py-0.5 rounded-full ${isToday ? 'bg-[#fff848] text-black font-bold' : inMonth ? 'text-gray-700' : 'text-gray-300'}`}>{d.getDate()}</span>
                  {inMonth && <Pencil className="h-3 w-3 text-gray-300 opacity-0 group-hover:opacity-100" />}
                </div>
                <div className="flex flex-col gap-0.5 overflow-hidden">
                  {cats.map((c) => (
                    <span key={c} title={CATS[c].desc} className={`text-[10px] leading-tight px-1.5 py-0.5 rounded border truncate ${CATS[c].chip}`}>{CATS[c].short}</span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2 px-4 py-3 border-t border-gray-100">
          {ORDER.map((k) => (
            <span key={k} className="flex items-center gap-1.5 text-[11px] text-gray-600">
              <span className={`h-2.5 w-2.5 rounded-full ${CATS[k].dot}`} />
              <span className="font-medium">{CATS[k].label}</span>
              <span className="text-gray-400 hidden sm:inline">— {CATS[k].desc}</span>
            </span>
          ))}
        </div>
      </div>

      <p className="text-xs text-gray-400">
        Standaard is alles automatisch op basis van werkdagen. Sleep een dag naar een andere datum of klik een dag aan
        om de fases handmatig te kiezen. "Reset maand" zet alle aanpassingen terug naar de standaardplanning.
      </p>

      {editing && (
        <DayEditor
          dateStr={editing}
          initial={effective(editing, true, isWeekday(new Date(editing + 'T00:00:00')))}
          onClose={() => setEditing(null)}
          onSave={(cats) => saveEdit(editing, cats)}
        />
      )}
    </div>
  )
}

function DayEditor({ dateStr, initial, onClose, onSave }: {
  dateStr: string; initial: CatKey[]; onClose: () => void; onSave: (cats: CatKey[]) => void
}) {
  const [sel, setSel] = useState<Set<CatKey>>(new Set(initial))
  const toggle = (k: CatKey) => setSel((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const label = new Date(dateStr + 'T00:00:00').toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold capitalize">{label}</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-2">
          <p className="text-xs text-gray-500 mb-2">Kies welke fases op deze dag actief zijn.</p>
          {ORDER.map((k) => {
            const active = sel.has(k)
            return (
              <button key={k} type="button" onClick={() => toggle(k)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-sm transition-colors ${active ? CATS[k].chip : 'border-gray-200 text-gray-600 hover:border-gray-300'}`}>
                <span className={`h-3.5 w-3.5 rounded-full ${CATS[k].dot}`} />
                <span className="flex-1">{CATS[k].label}</span>
                {active && <Check className="h-4 w-4" />}
              </button>
            )
          })}
        </div>
        <div className="flex gap-2 p-5 border-t border-gray-100">
          <button onClick={() => onSave([...sel])} className="btn-primary flex-1 justify-center"><Check className="h-4 w-4" />Opslaan</button>
          <button onClick={onClose} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </div>
  )
}
