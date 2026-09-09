'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  Plus, X, Loader2, Briefcase, ArrowDownLeft, ArrowUpRight,
  Check, Inbox, Send, Pencil, Trash2, HandCoins, RefreshCw, CheckCircle2,
} from 'lucide-react'
import { formatDate, formatEuro } from '@/lib/utils'
import { toast } from 'sonner'

type Assignment = {
  id: string
  title: string
  description: string | null
  service_slug: string | null
  roles?: string[]
  status: string
  budget: number | null
  payout?: number | null
  deadline: string | null
  client_id: string | null
  freelancer_id: string | null
  created_at: string
  origin: 'admin' | 'partner'
  deal_type?: string
  clickup_task_id?: string | null
  clickup_assignee?: string | null
  freelancers: { id: string; name: string; email: string } | null
  clients: { id: string; company_name: string } | null
}
type Partner = { id: string; name: string; email: string; roles: string[] }
type Client = { id: string; company_name: string }

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-orange-100 text-orange-700',
  in_progress: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-600',
}
const STATUS_LABEL: Record<string, string> = {
  open: 'Open', in_progress: 'Actief', completed: 'Afgerond', cancelled: 'Geannuleerd',
}

const ALL_ROLES = ['photographer', 'videographer', 'editor', 'designer', 'copywriter', 'developer', 'strategist', 'other']
const SERVICES_FOR_ASSIGNMENT = [
  { slug: '', label: '— Geen specifieke dienst —' },
  { slug: 'social-media', label: 'Social Media' },
  { slug: 'webdesign', label: 'Website' },
  { slug: 'foto-video', label: 'Foto & Videografie' },
  { slug: 'grafisch-ontwerp', label: 'Grafisch Ontwerp' },
  { slug: 'marketing-consultancy', label: 'Marketing Consultancy' },
  { slug: 'ads', label: 'Google Advertising' },
]

function CreateDialog({
  partners, clients, roleLabels, onClose, onCreated,
}: {
  partners: Partner[]
  clients: Client[]
  roleLabels: Record<string, string>
  onClose: () => void
  onCreated: (a: Assignment) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: '',
    description: '',
    roles: [] as string[],
    service_slug: '',
    client_id: '',
    freelancer_id: '',
    budget: '',
    deadline: '',
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (form.roles.length === 0) { setError('Selecteer minstens één rol'); return }
    if (!form.title.trim()) { setError('Titel is verplicht'); return }
    setLoading(true)
    try {
      const res = await fetch('/api/admin/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          roles: form.roles,
          service_slug: form.service_slug || null,
          client_id: form.client_id || null,
          freelancer_id: form.freelancer_id || null,
          budget: form.budget ? parseFloat(form.budget) : null,
          deadline: form.deadline || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Mislukt')
      onCreated({
        id: json.id,
        title: form.title,
        description: form.description || null,
        service_slug: form.service_slug || null,
        roles: form.roles,
        status: 'open',
        budget: form.budget ? parseFloat(form.budget) : null,
        payout: form.budget ? parseFloat(form.budget) : null,
        client_id: form.client_id || null,
        freelancer_id: form.freelancer_id || null,
        deadline: form.deadline || null,
        created_at: new Date().toISOString(),
        origin: 'admin',
        freelancers: form.freelancer_id ? partners.find(p => p.id === form.freelancer_id) ?? null : null,
        clients: form.client_id ? clients.find(c => c.id === form.client_id) ?? null : null,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout')
    } finally {
      setLoading(false)
    }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h3 className="font-semibold">Opdracht uitdelen</h3>
            <p className="text-xs text-gray-500 mt-0.5">Wijs werk toe aan een partner</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className={lbl}>Titel *</label>
            <input required className={inp} value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Omschrijving</label>
            <textarea rows={3} className={inp} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Rollen *</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 mt-1">
              {ALL_ROLES.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setForm((p) => ({
                    ...p,
                    roles: p.roles.includes(r) ? p.roles.filter((x) => x !== r) : [...p.roles, r],
                  }))}
                  className={`px-2 py-1.5 rounded-lg border text-xs transition-colors ${
                    form.roles.includes(r)
                      ? 'border-[#fff848] bg-[#fff848]/10 text-black'
                      : 'border-gray-200 text-gray-500'
                  }`}
                >
                  {roleLabels[r] ?? r}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={lbl}>Dienst (optioneel)</label>
            <select className={inp} value={form.service_slug} onChange={(e) => setForm((p) => ({ ...p, service_slug: e.target.value }))}>
              {SERVICES_FOR_ASSIGNMENT.map((s) => (
                <option key={s.slug || 'none'} value={s.slug}>{s.label}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Klant</label>
              <select className={inp} value={form.client_id} onChange={(e) => setForm((p) => ({ ...p, client_id: e.target.value }))}>
                <option value="">— Geen —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Partner</label>
              <select className={inp} value={form.freelancer_id} onChange={(e) => setForm((p) => ({ ...p, freelancer_id: e.target.value }))}>
                <option value="">— Open pool —</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Budget / payout (€)</label>
              <input type="number" min="0" step="0.01" className={inp} value={form.budget} onChange={(e) => setForm((p) => ({ ...p, budget: e.target.value }))} />
            </div>
            <div>
              <label className={lbl}>Deadline</label>
              <input type="date" className={inp} value={form.deadline} onChange={(e) => setForm((p) => ({ ...p, deadline: e.target.value }))} />
            </div>
          </div>
          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Toewijzen aan partner
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Annuleer</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AssignmentCard({
  a,
  roleLabels,
  busy,
  onStatus,
  onEdit,
  onDelete,
}: {
  a: Assignment
  roleLabels: Record<string, string>
  busy: boolean
  onStatus: (id: string, status: string) => void
  onEdit: (a: Assignment) => void
  onDelete: (a: Assignment) => void
}) {
  const amount = a.payout ?? a.budget
  const partnerName = a.freelancers?.name
  const isInbound = a.origin === 'partner'
  const isCommission = a.deal_type === 'commission'

  return (
    <div className="card-base">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm">{a.title}</span>
            {isCommission && (
              <span className="text-xs bg-[#fff848]/30 text-[#7a6f00] px-2 py-0.5 rounded font-medium">
                Commissie
              </span>
            )}
            {a.service_slug && (
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                {a.service_slug}
              </span>
            )}
            {a.roles && a.roles.length > 0 && a.roles.slice(0, 2).map((r) => (
              <span key={r} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                {roleLabels[r] ?? r}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-gray-400">
            {isInbound ? (
              <span className="flex items-center gap-1 text-purple-600 font-medium">
                <ArrowDownLeft className="h-3 w-3" />
                Van {partnerName ?? 'partner'}
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <ArrowUpRight className="h-3 w-3" />
                {partnerName ? `Naar ${partnerName}` : 'Open pool'}
              </span>
            )}
            {a.clients && <span>· {a.clients.company_name}</span>}
            {a.deadline && <span>· Deadline {formatDate(a.deadline)}</span>}
            <span>· {formatDate(a.created_at)}</span>
          </div>
          {a.description && (
            <p className="text-sm text-gray-600 mt-2 line-clamp-2">{a.description}</p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {amount != null && <span className="text-sm font-bold">{formatEuro(amount)}</span>}
          <span className={`status-badge ${STATUS_STYLE[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
            {STATUS_LABEL[a.status] ?? a.status}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => onEdit(a)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400" title="Bewerken">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button onClick={() => onDelete(a)} disabled={busy} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400" title="Verwijderen">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Commission proposal hint */}
      {isInbound && isCommission && a.status !== 'cancelled' && a.freelancer_id && (
        <div className="mt-3 flex items-center justify-between gap-2 flex-wrap rounded-lg bg-[#fff848]/10 border border-[#fff848]/40 px-3 py-2">
          <span className="text-xs text-gray-600">
            Commissievoorstel — koppel de klant + contractwaarde om de commissiedeal (10/8/5%) op te starten.
          </span>
          <Link
            href={`/admin/partners/${a.freelancer_id}#commissie`}
            className="btn-primary text-xs py-1.5 shrink-0"
          >
            <HandCoins className="h-3.5 w-3.5" />
            Commissiedeal aanmaken
          </Link>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 flex-wrap mt-3 pt-3 border-t border-gray-50">
        {isInbound && a.status === 'open' && (
          <>
            <button
              onClick={() => onStatus(a.id, 'in_progress')}
              disabled={busy}
              className="btn-primary text-xs py-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Aanvaarden
            </button>
            <button
              onClick={() => onStatus(a.id, 'cancelled')}
              disabled={busy}
              className="btn-secondary text-xs py-1.5 text-red-500 hover:bg-red-50"
            >
              <X className="h-3.5 w-3.5" />
              Weigeren
            </button>
          </>
        )}
        {!isInbound && a.status === 'open' && (
          <button
            onClick={() => onStatus(a.id, 'cancelled')}
            disabled={busy}
            className="btn-secondary text-xs py-1.5 text-red-500 hover:bg-red-50"
          >
            Annuleren
          </button>
        )}
        {a.status === 'in_progress' && (
          <>
            <button
              onClick={() => onStatus(a.id, 'completed')}
              disabled={busy}
              className="btn-primary text-xs py-1.5"
            >
              <Check className="h-3.5 w-3.5" />
              Afronden
            </button>
            <button
              onClick={() => onStatus(a.id, 'cancelled')}
              disabled={busy}
              className="btn-secondary text-xs py-1.5 text-red-500 hover:bg-red-50"
            >
              Annuleren
            </button>
          </>
        )}
        {(a.status === 'completed' || a.status === 'cancelled') && (
          <span className="text-xs text-gray-400">Geen acties meer mogelijk</span>
        )}
      </div>

      {/* ClickUp-sync (opdracht → ClickUp, AI-naammatching voor toewijzing) */}
      <ClickupSync assignmentId={a.id} synced={!!a.clickup_task_id} assignee={a.clickup_assignee ?? null} />
    </div>
  )
}

function ClickupSync({ assignmentId, synced, assignee }: { assignmentId: string; synced: boolean; assignee: string | null }) {
  const [preview, setPreview] = useState<null | { partnerName: string | null; match: { name: string; method: string; confidence: number } | null; configured: boolean }>(null)
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(synced ? assignee : null)

  const openPreview = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/assignments/${assignmentId}/clickup-sync`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      if (!j.configured) { toast.error('ClickUp niet geconfigureerd (CLICKUP_API_KEY ontbreekt).'); return }
      setPreview({ partnerName: j.partnerName, match: j.match, configured: true })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setLoading(false) }
  }

  const sync = async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/assignments/${assignmentId}/clickup-sync`, { method: 'POST' })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setDone(j.match?.name ?? 'niet toegewezen')
      setPreview(null)
      toast.success(j.warning ? `Gesynct — ${j.warning}` : `Gesynct naar ClickUp${j.match ? ` · toegewezen aan ${j.match.name}` : ''}`)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setLoading(false) }
  }

  return (
    <div className="mt-2 pt-2 border-t border-gray-50 flex items-center gap-2 flex-wrap text-xs">
      {done ? (
        <span className="inline-flex items-center gap-1 text-green-600"><CheckCircle2 className="h-3.5 w-3.5" />In ClickUp{done && done !== 'niet toegewezen' ? ` · ${done}` : ''}</span>
      ) : (
        <span className="text-gray-400">Nog niet in ClickUp</span>
      )}
      {!preview ? (
        <button onClick={openPreview} disabled={loading} className="btn-secondary text-xs py-1 ml-auto">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {done ? 'Opnieuw syncen' : 'Sync ClickUp'}
        </button>
      ) : (
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <span className="text-gray-500">
            {preview.match
              ? <>Toewijzen aan <b>{preview.match.name}</b> <span className="text-gray-400">({preview.match.method}, {Math.round(preview.match.confidence * 100)}%)</span></>
              : <span className="text-amber-600">Geen partner-match in ClickUp{preview.partnerName ? ` voor "${preview.partnerName}"` : ''}</span>}
          </span>
          <button onClick={sync} disabled={loading} className="btn-primary text-xs py-1">{loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Bevestig sync</button>
          <button onClick={() => setPreview(null)} className="btn-secondary text-xs py-1">Annuleer</button>
        </div>
      )}
    </div>
  )
}

type Tab = 'outbound' | 'inbound'

export function AssignmentsClient({
  initialAssignments, partners, clients, roleLabels,
}: {
  initialAssignments: Assignment[]
  partners: Partner[]
  clients: Client[]
  roleLabels: Record<string, string>
}) {
  const router = useRouter()
  const [assignments, setAssignments] = useState(initialAssignments)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Assignment | null>(null)
  const [tab, setTab] = useState<Tab>('outbound')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [busyId, setBusyId] = useState<string | null>(null)

  const deleteAssignment = async (a: Assignment) => {
    if (!confirm(`Opdracht "${a.title}" definitief verwijderen?`)) return
    setBusyId(a.id)
    try {
      const res = await fetch(`/api/admin/assignments?id=${a.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setAssignments((prev) => prev.filter((x) => x.id !== a.id))
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fout bij verwijderen')
    } finally {
      setBusyId(null)
    }
  }

  const outbound = useMemo(() => assignments.filter((a) => a.origin === 'admin'), [assignments])
  const inbound = useMemo(() => assignments.filter((a) => a.origin === 'partner'), [assignments])

  // Number of inbound proposals awaiting a decision
  const inboxCount = useMemo(() => inbound.filter((a) => a.status === 'open').length, [inbound])

  const base = tab === 'outbound' ? outbound : inbound
  const visible = statusFilter === 'all' ? base : base.filter((a) => a.status === statusFilter)

  const updateStatus = async (id: string, status: string) => {
    setBusyId(id)
    try {
      const res = await fetch('/api/admin/assignments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setAssignments((prev) => prev.map((a) => a.id === id ? { ...a, status } : a))
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fout bij statusupdate')
    } finally {
      setBusyId(null)
    }
  }

  const TabButton = ({ value, label, icon: Icon, count, badge }: {
    value: Tab; label: string; icon: typeof Inbox; count: number; badge?: number
  }) => (
    <button
      onClick={() => { setTab(value); setStatusFilter('all') }}
      className={`relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
        tab === value ? 'bg-black text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
      <span className={`text-xs ${tab === value ? 'opacity-70' : 'text-gray-400'}`}>({count})</span>
      {badge ? (
        <span className="absolute -top-1.5 -right-1.5 h-5 min-w-[20px] px-1 rounded-full bg-purple-600 text-white text-[10px] font-bold flex items-center justify-center">
          {badge}
        </span>
      ) : null}
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Tabs + create */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <TabButton value="outbound" label="Uitgaand" icon={ArrowUpRight} count={outbound.length} />
          <TabButton value="inbound" label="Inkomend" icon={Inbox} count={inbound.length} badge={inboxCount} />
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-primary">
          <Plus className="h-4 w-4" />
          Opdracht uitdelen
        </button>
      </div>

      {/* Context line */}
      <p className="text-sm text-gray-500">
        {tab === 'outbound'
          ? 'Opdrachten die NextGenMedia aan partners heeft uitgedeeld.'
          : 'Voorstellen die partners bij NextGenMedia hebben ingediend — aanvaard of weiger ze.'}
      </p>

      {/* Status filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['all', 'open', 'in_progress', 'completed', 'cancelled'] as const).map((s) => {
          const cnt = s === 'all' ? base.length : base.filter((a) => a.status === s).length
          return (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                statusFilter === s ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-500 hover:border-gray-300'
              }`}
            >
              {s === 'all' ? 'Alle' : STATUS_LABEL[s]} <span className="opacity-60">{cnt}</span>
            </button>
          )
        })}
      </div>

      {/* List */}
      {visible.length === 0 ? (
        <div className="card-base text-center py-14 text-gray-400">
          <Briefcase className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            {tab === 'inbound' ? 'Geen inkomende voorstellen' : 'Geen uitgaande opdrachten'}
          </p>
          {tab === 'outbound' && (
            <button onClick={() => setShowCreate(true)} className="btn-primary mt-4 inline-flex text-sm">
              <Plus className="h-4 w-4" />
              Eerste opdracht uitdelen
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map((a) => (
            <AssignmentCard
              key={a.id}
              a={a}
              roleLabels={roleLabels}
              busy={busyId === a.id}
              onStatus={updateStatus}
              onEdit={setEditing}
              onDelete={deleteAssignment}
            />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateDialog
          partners={partners}
          clients={clients}
          roleLabels={roleLabels}
          onClose={() => setShowCreate(false)}
          onCreated={(a) => { setAssignments((prev) => [a, ...prev]); setShowCreate(false); setTab('outbound') }}
        />
      )}

      {editing && (
        <EditDialog
          assignment={editing}
          partners={partners}
          clients={clients}
          onClose={() => setEditing(null)}
          onSaved={(updated) => {
            setAssignments((prev) => prev.map((x) => x.id === updated.id ? { ...x, ...updated } : x))
            setEditing(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

function EditDialog({
  assignment, partners, clients, onClose, onSaved,
}: {
  assignment: Assignment
  partners: Partner[]
  clients: Client[]
  onClose: () => void
  onSaved: (a: Assignment) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    title: assignment.title,
    description: assignment.description ?? '',
    service_slug: assignment.service_slug ?? '',
    client_id: assignment.client_id ?? '',
    freelancer_id: assignment.freelancer_id ?? '',
    budget: (assignment.payout ?? assignment.budget) != null ? String(assignment.payout ?? assignment.budget) : '',
    deadline: assignment.deadline ?? '',
    status: assignment.status,
  })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.title.trim()) { setError('Titel is verplicht'); return }
    setLoading(true)
    try {
      const amount = form.budget ? parseFloat(form.budget) : null
      const res = await fetch('/api/admin/assignments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: assignment.id,
          title: form.title,
          description: form.description || null,
          service_slug: form.service_slug || null,
          client_id: form.client_id || null,
          freelancer_id: form.freelancer_id || null,
          budget: amount,
          payout: amount,
          deadline: form.deadline || null,
          status: form.status,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      onSaved({
        ...assignment,
        title: form.title,
        description: form.description || null,
        service_slug: form.service_slug || null,
        client_id: form.client_id || null,
        freelancer_id: form.freelancer_id || null,
        budget: amount,
        payout: amount,
        deadline: form.deadline || null,
        status: form.status,
        clients: form.client_id ? clients.find((c) => c.id === form.client_id) ?? null : null,
        freelancers: form.freelancer_id ? partners.find((p) => p.id === form.freelancer_id) ?? null : null,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout')
    } finally {
      setLoading(false)
    }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold">Opdracht bewerken</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className={lbl}>Titel *</label>
            <input className={inp} value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Omschrijving</label>
            <textarea rows={3} className={inp} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Dienst</label>
            <select className={inp} value={form.service_slug} onChange={(e) => setForm((p) => ({ ...p, service_slug: e.target.value }))}>
              {SERVICES_FOR_ASSIGNMENT.map((s) => <option key={s.slug || 'none'} value={s.slug}>{s.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Klant</label>
              <select className={inp} value={form.client_id} onChange={(e) => setForm((p) => ({ ...p, client_id: e.target.value }))}>
                <option value="">— Geen —</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Partner</label>
              <select className={inp} value={form.freelancer_id} onChange={(e) => setForm((p) => ({ ...p, freelancer_id: e.target.value }))}>
                <option value="">— Open pool —</option>
                {partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className={lbl}>Bedrag (€)</label>
              <input type="number" min="0" step="0.01" className={inp} value={form.budget} onChange={(e) => setForm((p) => ({ ...p, budget: e.target.value }))} />
            </div>
            <div>
              <label className={lbl}>Deadline</label>
              <input type="date" className={inp} value={form.deadline} onChange={(e) => setForm((p) => ({ ...p, deadline: e.target.value }))} />
            </div>
          </div>
          <div>
            <label className={lbl}>Status</label>
            <select className={inp} value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value }))}>
              <option value="open">Open</option>
              <option value="in_progress">Actief</option>
              <option value="completed">Afgerond</option>
              <option value="cancelled">Geannuleerd</option>
            </select>
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Opslaan
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Annuleer</button>
          </div>
        </form>
      </div>
    </div>
  )
}
