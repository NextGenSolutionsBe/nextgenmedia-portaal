'use client'

import { useEffect, useState, useCallback } from 'react'
import { Camera, Plus, Pencil, Trash2, Loader2, Check, X, Calendar, Clock, MapPin, MessageSquare, Lightbulb, Paperclip } from 'lucide-react'
import { formatDate } from '@/lib/utils'

type Feedback = { id: string; author_role: string; message: string; resolved: boolean; created_at: string }
type Idea = { id: string; title: string | null; description: string | null; attachment_url: string | null; status: string; admin_note: string | null; created_at: string }
const IDEA_STATUS = [{ v: 'new', l: 'Nieuw' }, { v: 'seen', l: 'Bekeken' }, { v: 'use', l: 'Meenemen in shoot' }, { v: 'discard', l: 'Niet gebruiken' }]

export type Shoot = {
  id: string
  shoot_date: string | null
  start_time: string | null
  end_time: string | null
  location: string | null
  briefing: string | null
}

type FormState = { shoot_date: string; start_time: string; end_time: string; location: string; briefing: string }
const empty: FormState = { shoot_date: '', start_time: '', end_time: '', location: '', briefing: '' }
const toForm = (s: Shoot): FormState => ({
  shoot_date: s.shoot_date ?? '', start_time: s.start_time ?? '', end_time: s.end_time ?? '',
  location: s.location ?? '', briefing: s.briefing ?? '',
})

export function ShootBriefings({ clientId }: { clientId: string }) {
  const [shoots, setShoots] = useState<Shoot[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const base = `/api/admin/clients/${clientId}/shoot-briefings`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(base)
      const json = await res.json()
      if (res.ok) setShoots(json.shoots ?? [])
    } catch { /* stil */ } finally { setLoading(false) }
  }, [base])

  useEffect(() => { setAdding(false); setEditingId(null); load() }, [load])

  return (
    <div className="card-base">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Camera className="h-4 w-4 text-purple-500" />
            Shoot Briefing
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Shootmomenten + briefing — zichtbaar voor de klant in zijn portaal.</p>
        </div>
        {!adding && (
          <button onClick={() => { setAdding(true); setEditingId(null) }} className="btn-secondary text-xs">
            <Plus className="h-3.5 w-3.5" />
            Shoot toevoegen
          </button>
        )}
      </div>

      {adding && (
        <ShootForm
          base={base}
          initial={empty}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); load() }}
        />
      )}

      {loading ? (
        <div className="flex items-center justify-center py-8 text-gray-400">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : shoots.length === 0 && !adding ? (
        <div className="text-center py-8 text-gray-400">
          <Camera className="h-7 w-7 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Nog geen shoots gepland</p>
        </div>
      ) : (
        <div className="space-y-3">
          {shoots.map((s) =>
            editingId === s.id ? (
              <ShootForm
                key={s.id}
                base={base}
                shootId={s.id}
                initial={toForm(s)}
                onClose={() => setEditingId(null)}
                onSaved={() => { setEditingId(null); load() }}
              />
            ) : (
              <ShootCard key={s.id} shoot={s} base={base} onEdit={() => { setEditingId(s.id); setAdding(false) }} onDeleted={load} />
            )
          )}
        </div>
      )}
    </div>
  )
}

function ShootCard({ shoot, base, onEdit, onDeleted }: {
  shoot: Shoot; base: string; onEdit: () => void; onDeleted: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState<Feedback[]>([])
  const time = [shoot.start_time, shoot.end_time].filter(Boolean).join(' – ')

  const loadFeedback = useCallback(async () => {
    try {
      const res = await fetch(`/api/admin/shoot-feedback?shoot_id=${shoot.id}`)
      const json = await res.json()
      if (res.ok) setFeedback(json.feedback ?? [])
    } catch { /* stil */ }
  }, [shoot.id])

  useEffect(() => { loadFeedback() }, [loadFeedback])

  const [ideas, setIdeas] = useState<Idea[]>([])
  const loadIdeas = useCallback(async () => {
    try { const res = await fetch(`/api/admin/shoot-ideas?shoot_id=${shoot.id}`); const j = await res.json(); if (res.ok) setIdeas(j.ideas ?? []) } catch { /* stil */ }
  }, [shoot.id])
  useEffect(() => { loadIdeas() }, [loadIdeas])

  const patchIdea = async (id: string, patch: { status?: string; admin_note?: string }) => {
    setIdeas(list => list.map(i => i.id === id ? { ...i, ...patch } : i))
    try { await fetch('/api/admin/shoot-ideas', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idea_id: id, ...patch }) }) } catch { /* stil */ }
  }

  const toggleResolved = async (f: Feedback) => {
    try {
      const res = await fetch('/api/admin/shoot-feedback', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback_id: f.id, resolved: !f.resolved }),
      })
      if (res.ok) setFeedback((list) => list.map((x) => x.id === f.id ? { ...x, resolved: !x.resolved } : x))
    } catch { /* stil */ }
  }

  const remove = async () => {
    if (!confirm('Deze shoot verwijderen?')) return
    setBusy(true)
    try {
      const res = await fetch(`${base}?shoot_id=${shoot.id}`, { method: 'DELETE' })
      if (res.ok) onDeleted()
    } finally { setBusy(false) }
  }

  const openCount = feedback.filter((f) => !f.resolved && f.author_role === 'client').length

  return (
    <div className="border border-gray-200 rounded-xl p-4">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span className="flex items-center gap-1.5 font-medium"><Calendar className="h-3.5 w-3.5 text-gray-400" />{shoot.shoot_date ? formatDate(shoot.shoot_date) : 'Datum n.t.b.'}</span>
          {time && <span className="flex items-center gap-1.5 text-gray-600"><Clock className="h-3.5 w-3.5 text-gray-400" />{time}</span>}
          {shoot.location && <span className="flex items-center gap-1.5 text-gray-600"><MapPin className="h-3.5 w-3.5 text-gray-400" />{shoot.location}</span>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button onClick={onEdit} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400" title="Bewerken"><Pencil className="h-3.5 w-3.5" /></button>
          <button onClick={remove} disabled={busy} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400" title="Verwijderen">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {shoot.briefing && (
        <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed bg-gray-50 rounded-lg p-3 mt-2">{shoot.briefing}</p>
      )}

      {feedback.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <MessageSquare className="h-3.5 w-3.5" /> Feedback van klant
            {openCount > 0 && (
              <span className="bg-amber-100 text-amber-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full">{openCount} onverwerkt</span>
            )}
          </div>
          {feedback.map((f) => (
            <div key={f.id} className={`text-sm rounded-lg px-3 py-2 border ${f.resolved ? 'bg-gray-50 border-gray-200 opacity-70' : 'bg-blue-50/60 border-blue-100'}`}>
              <div className="flex items-center justify-between gap-2 mb-0.5">
                <span className="text-[11px] font-medium text-gray-500">{f.author_role === 'admin' ? 'NextGenMedia' : 'Klant'}</span>
                <button
                  onClick={() => toggleResolved(f)}
                  className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border ${
                    f.resolved ? 'border-green-200 text-green-700 bg-green-100' : 'border-gray-200 text-gray-500 hover:bg-gray-100'
                  }`}
                  title={f.resolved ? 'Markeer als onverwerkt' : 'Markeer als verwerkt'}
                >
                  <Check className="h-2.5 w-2.5" /> {f.resolved ? 'Verwerkt' : 'Markeer verwerkt'}
                </button>
              </div>
              <p className="text-gray-700 whitespace-pre-wrap">{f.message}</p>
            </div>
          ))}
        </div>
      )}

      {ideas.length > 0 && (
        <div className="mt-3 border-t border-gray-100 pt-3 space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-gray-500"><Lightbulb className="h-3.5 w-3.5" />Ideeën van de klant</div>
          {ideas.map((i) => (
            <div key={i.id} className="text-sm rounded-lg px-3 py-2 border border-gray-100 bg-gray-50/60 space-y-1.5">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="min-w-0">
                  <div className="font-medium">{i.title || 'Idee'}</div>
                  {i.description && <p className="text-gray-600 whitespace-pre-wrap">{i.description}</p>}
                  {i.attachment_url && <a href={i.attachment_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-0.5"><Paperclip className="h-3 w-3" />Bijlage</a>}
                  <div className="text-[11px] text-gray-400 mt-0.5">{formatDate(i.created_at)}</div>
                </div>
                <select value={i.status} onChange={(e) => patchIdea(i.id, { status: e.target.value })}
                  className="text-xs px-2 py-1 rounded-lg border border-gray-200 shrink-0">
                  {IDEA_STATUS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
                </select>
              </div>
              <input defaultValue={i.admin_note ?? ''} onBlur={(e) => { if (e.target.value !== (i.admin_note ?? '')) patchIdea(i.id, { admin_note: e.target.value }) }}
                placeholder="Interne notitie…" className="w-full px-2.5 py-1.5 text-xs border border-gray-200 rounded-lg" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function ShootForm({ base, shootId, initial, onClose, onSaved }: {
  base: string; shootId?: string; initial: FormState; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState<FormState>(initial)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  const save = async () => {
    setError(null); setLoading(true)
    try {
      const res = await fetch(base, {
        method: shootId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(shootId ? { shoot_id: shootId, ...form } : form),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fout')
    } finally { setLoading(false) }
  }

  return (
    <div className="border border-[#fff848] bg-[#fff848]/5 rounded-xl p-4 space-y-3 mb-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className={lbl}>Datum</label>
          <input type="date" className={inp} value={form.shoot_date} onChange={(e) => setForm((p) => ({ ...p, shoot_date: e.target.value }))} />
        </div>
        <div>
          <label className={lbl}>Startuur</label>
          <input type="time" className={inp} value={form.start_time} onChange={(e) => setForm((p) => ({ ...p, start_time: e.target.value }))} />
        </div>
        <div>
          <label className={lbl}>Einduur</label>
          <input type="time" className={inp} value={form.end_time} onChange={(e) => setForm((p) => ({ ...p, end_time: e.target.value }))} />
        </div>
      </div>
      <div>
        <label className={lbl}>Locatie</label>
        <input className={inp} value={form.location} onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} placeholder="Adres / locatie van de shoot" />
      </div>
      <div>
        <label className={lbl}>Shoot Briefing</label>
        <textarea
          rows={8}
          className={`${inp} font-mono`}
          value={form.briefing}
          onChange={(e) => setForm((p) => ({ ...p, briefing: e.target.value }))}
          placeholder={'Wat wordt er gefilmd, welke reels/posts, benodigde beelden, aanwezige medewerkers, materialen, praktische afspraken, adres, parking, contactpersoon...'}
        />
      </div>
      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
      <div className="flex gap-2">
        <button onClick={save} disabled={loading} className="btn-primary text-sm justify-center">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Opslaan
        </button>
        <button onClick={onClose} className="btn-secondary text-sm"><X className="h-4 w-4" />Annuleer</button>
      </div>
    </div>
  )
}
