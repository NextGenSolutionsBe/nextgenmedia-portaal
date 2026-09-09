'use client'

import { useState } from 'react'
import { formatEuro, formatDate, SERVICE_LABELS } from '@/lib/utils'
import { Briefcase, CheckCircle2, ChevronDown, Plus, X, Loader2, Send } from 'lucide-react'

type Assignment = {
  id: string
  title: string
  description: string | null
  status: string
  budget: number | null
  payout: number | null
  deadline: string | null
  created_at: string
  service_slug: string | null
  origin: 'admin' | 'partner'
  client_name: string | null
}

const STATUS_STYLE: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-600',
}
const STATUS_LABEL: Record<string, string> = {
  open: 'Openstaand', in_progress: 'Actief', completed: 'Afgerond', cancelled: 'Geannuleerd',
}

const SERVICE_OPTIONS = [
  { slug: '', label: '— Geen specifieke dienst —' },
  { slug: 'social-media', label: 'Social Media' },
  { slug: 'webdesign', label: 'Website / Development' },
  { slug: 'foto-video', label: 'Foto & Videografie' },
  { slug: 'grafisch-ontwerp', label: 'Grafisch Ontwerp' },
  { slug: 'marketing-consultancy', label: 'Marketing Consultancy' },
  { slug: 'ads', label: 'Google Advertising' },
]

const FILTERS = ['all', 'open', 'in_progress', 'completed', 'cancelled'] as const

function SubmitWorkDialog({
  hourlyRate,
  onClose,
  onCreated,
}: {
  hourlyRate: number | null
  onClose: () => void
  onCreated: (a: Assignment) => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dealType, setDealType] = useState<'commission' | 'fixed'>('commission')
  const [form, setForm] = useState({
    title: '',
    description: '',
    service_slug: '',
    budget_type: 'fixed' as 'fixed' | 'hourly',
    proposed_budget: '',
    proposed_hours: '',
    deadline: '',
  })

  const computedBudget = form.budget_type === 'hourly' && form.proposed_hours && hourlyRate
    ? Math.round(parseFloat(form.proposed_hours) * hourlyRate * 100) / 100
    : null

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.title.trim()) { setError('Titel is verplicht'); return }

    const budget = dealType === 'fixed'
      ? (form.budget_type === 'fixed'
          ? (form.proposed_budget ? parseFloat(form.proposed_budget) : null)
          : computedBudget)
      : null

    setLoading(true)
    try {
      const res = await fetch('/api/partner/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: form.title,
          description: form.description || null,
          service_slug: form.service_slug || null,
          deal_type: dealType,
          proposed_budget: budget,
          deadline: form.deadline || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Mislukt')
      onCreated({
        id: json.id,
        title: form.title,
        description: form.description || null,
        status: 'open',
        budget: budget,
        payout: budget,
        deadline: form.deadline || null,
        created_at: new Date().toISOString(),
        service_slug: form.service_slug || null,
        origin: 'partner',
        client_name: null,
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout')
    } finally {
      setLoading(false)
    }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
  const lbl = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h3 className="font-semibold text-gray-900">Opdracht indienen</h3>
            <p className="text-xs text-gray-500 mt-0.5">Dien een voorstel in bij NextGenMedia</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Deal type */}
          <div>
            <label className={lbl}>Soort voorstel</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDealType('commission')}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  dealType === 'commission' ? 'border-[#fff848] bg-[#fff848]/10' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-sm font-semibold">Klant aanbrengen</div>
                <div className="text-[11px] text-gray-500 mt-0.5">Jij levert een klant aan, wij voeren uit, jij krijgt commissie.</div>
              </button>
              <button
                type="button"
                onClick={() => setDealType('fixed')}
                className={`rounded-xl border p-3 text-left transition-colors ${
                  dealType === 'fixed' ? 'border-[#fff848] bg-[#fff848]/10' : 'border-gray-200 hover:border-gray-300'
                }`}
              >
                <div className="text-sm font-semibold">Wij doen werk voor jou</div>
                <div className="text-[11px] text-gray-500 mt-0.5">Jij geeft ons een opdracht voor een vast bedrag.</div>
              </button>
            </div>
          </div>

          <div>
            <label className={lbl}>Titel *</label>
            <input
              required
              className={inp}
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              placeholder={dealType === 'commission' ? 'Bijv. Bakkerij Janssens — social media' : 'Bijv. Fotoshoot productlijn december'}
            />
          </div>
          <div>
            <label className={lbl}>Omschrijving</label>
            <textarea
              rows={3}
              className={inp}
              value={form.description}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Wat houdt de opdracht in? Wat lever je op?"
            />
          </div>
          <div>
            <label className={lbl}>Dienst / categorie</label>
            <select className={inp} value={form.service_slug} onChange={(e) => setForm((p) => ({ ...p, service_slug: e.target.value }))}>
              {SERVICE_OPTIONS.map((s) => (
                <option key={s.slug || 'none'} value={s.slug}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Commission: no amount — admin fills contract value later */}
          {dealType === 'commission' ? (
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700">
              Je brengt een klant aan. NextGenMedia bepaalt na het tekenen de contractwaarde
              en jij ontvangt commissie per actief jaar van die klant (standaard 10% / 8% / 5%).
            </div>
          ) : (
            <>
              {/* Budget — only for fixed proposals */}
              <div className="space-y-3">
                <label className={lbl}>Vergoeding</label>
                <div className="flex gap-2">
                  {(['fixed', 'hourly'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setForm((p) => ({ ...p, budget_type: t }))}
                      className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${
                        form.budget_type === t
                          ? 'border-[#fff848] bg-[#fff848]/10 text-black'
                          : 'border-gray-200 text-gray-500 hover:border-gray-300'
                      }`}
                    >
                      {t === 'fixed' ? 'Vast bedrag' : 'Op uren'}
                    </button>
                  ))}
                </div>

                {form.budget_type === 'fixed' ? (
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Bedrag (€)</label>
                    <input
                      type="number" min="0" step="0.01" className={inp}
                      value={form.proposed_budget}
                      onChange={(e) => setForm((p) => ({ ...p, proposed_budget: e.target.value }))}
                      placeholder="500"
                    />
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Aantal uren</label>
                      <input
                        type="number" min="0" step="0.5" className={inp}
                        value={form.proposed_hours}
                        onChange={(e) => setForm((p) => ({ ...p, proposed_hours: e.target.value }))}
                        placeholder="8"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Uurtarief (€)</label>
                      <input
                        type="number" min="0" className={`${inp} bg-gray-50`}
                        value={hourlyRate ?? ''} readOnly
                        placeholder={hourlyRate ? String(hourlyRate) : 'Niet ingesteld'}
                      />
                    </div>
                    {computedBudget != null && (
                      <div className="col-span-2 text-sm font-semibold text-green-700 bg-green-50 rounded-lg px-3 py-2">
                        Totaal: {formatEuro(computedBudget)}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <label className={lbl}>Gewenste deadline</label>
                <input
                  type="date" className={inp}
                  value={form.deadline}
                  onChange={(e) => setForm((p) => ({ ...p, deadline: e.target.value }))}
                />
              </div>
            </>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Indienen bij NextGenMedia
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Annuleer</button>
          </div>
        </form>
      </div>
    </div>
  )
}

type Tab = 'received' | 'proposed'

export function PartnerAssignmentsClient({
  partnerId,
  hourlyRate,
  initialAssignments,
}: {
  partnerId: string
  hourlyRate: number | null
  initialAssignments: Assignment[]
}) {
  const [assignments, setAssignments] = useState(initialAssignments)
  const [tab, setTab] = useState<Tab>('received')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [showSubmit, setShowSubmit] = useState(false)

  // received  = work NextGenMedia gave to this partner (origin = admin)
  // proposed  = work this partner proposed TO NextGenMedia (origin = partner)
  const received = assignments.filter((a) => a.origin === 'admin')
  const proposed = assignments.filter((a) => a.origin === 'partner')

  const newReceivedCount = received.filter((a) => a.status === 'open').length

  const list = tab === 'received' ? received : proposed

  const updateStatus = async (id: string, status: string) => {
    setLoading(id)
    try {
      const res = await fetch('/api/partner/assignments', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      if (!res.ok) {
        const j = await res.json()
        throw new Error(j.error)
      }
      setAssignments((prev) => prev.map((a) => a.id === id ? { ...a, status } : a))
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fout')
    } finally {
      setLoading(null)
    }
  }

  const TabButton = ({ value, label, count, badge }: {
    value: Tab; label: string; count: number; badge?: number
  }) => (
    <button
      onClick={() => { setTab(value); setExpanded(null) }}
      className={`relative flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-colors ${
        tab === value ? 'bg-black text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
      }`}
    >
      {label}
      <span className={`text-xs ${tab === value ? 'opacity-70' : 'text-gray-400'}`}>({count})</span>
      {badge ? (
        <span className="absolute -top-1.5 -right-1.5 h-5 min-w-[20px] px-1 rounded-full bg-[#c5b800] text-black text-[10px] font-bold flex items-center justify-center">
          {badge}
        </span>
      ) : null}
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Tabs + submit */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 flex-wrap">
          <TabButton value="received" label="Van NextGenMedia" count={received.length} badge={newReceivedCount} />
          <TabButton value="proposed" label="Mijn voorstellen" count={proposed.length} />
        </div>
        <button onClick={() => setShowSubmit(true)} className="btn-primary">
          <Plus className="h-4 w-4" />
          Opdracht indienen
        </button>
      </div>

      {/* Context line */}
      <div className="bg-[#fff848]/10 border border-[#fff848]/40 rounded-xl p-3 text-sm text-gray-700">
        {tab === 'received'
          ? <><strong>Opdrachten van NextGenMedia</strong> — werk dat aan jou is toegewezen. Accepteer en rond af.</>
          : <><strong>Mijn voorstellen</strong> — opdrachten die jij bij NextGenMedia hebt ingediend. Wij keuren ze goed. Je kan een openstaand voorstel intrekken.</>}
      </div>

      {list.length === 0 ? (
        <div className="card-base text-center py-14 text-gray-400">
          <Briefcase className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            {tab === 'received' ? 'Nog geen opdrachten van NextGenMedia' : 'Je hebt nog geen voorstellen ingediend'}
          </p>
          {tab === 'proposed' && (
            <button onClick={() => setShowSubmit(true)} className="btn-primary mt-4 inline-flex text-sm">
              <Plus className="h-4 w-4" />
              Opdracht indienen
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {list.map((a) => {
            const isReceived = a.origin === 'admin'
            return (
            <div key={a.id} className="card-base">
              <div
                className="flex items-start justify-between gap-3 cursor-pointer"
                onClick={() => setExpanded(expanded === a.id ? null : a.id)}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{a.title}</span>
                    {a.service_slug && (
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        {SERVICE_LABELS[a.service_slug] ?? a.service_slug}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {a.client_name && (
                      <span className="text-xs text-gray-400">{a.client_name}</span>
                    )}
                    {a.deadline && (
                      <span className="text-xs text-gray-400">Deadline: {formatDate(a.deadline)}</span>
                    )}
                    <span className="text-xs text-gray-400">{formatDate(a.created_at)}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(a.payout ?? a.budget) != null && (
                    <span className="text-sm font-bold">{formatEuro(a.payout ?? a.budget)}</span>
                  )}
                  <span className={`status-badge ${STATUS_STYLE[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {/* For partner proposals an "open" status means "awaiting approval" */}
                    {!isReceived && a.status === 'open' ? 'Wacht op goedkeuring' : (STATUS_LABEL[a.status] ?? a.status)}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${expanded === a.id ? 'rotate-180' : ''}`} />
                </div>
              </div>

              {expanded === a.id && (
                <div className="mt-4 pt-4 border-t border-gray-100 space-y-3">
                  {a.description && (
                    <p className="text-sm text-gray-600 whitespace-pre-line">{a.description}</p>
                  )}
                  <div className="flex items-center gap-4 text-sm flex-wrap">
                    {a.budget != null && (
                      <span className="text-gray-500">Budget: <span className="font-medium text-gray-900">{formatEuro(a.budget)}</span></span>
                    )}
                    {a.payout != null && a.payout !== a.budget && (
                      <span className="text-gray-500">Uitbetaling: <span className="font-medium text-gray-900">{formatEuro(a.payout)}</span></span>
                    )}
                  </div>

                  {/* ── RECEIVED (admin → partner): partner accepts & completes ── */}
                  {isReceived ? (
                    <div className="flex gap-2 flex-wrap">
                      {a.status === 'open' && (
                        <button
                          onClick={() => updateStatus(a.id, 'in_progress')}
                          disabled={loading === a.id}
                          className="btn-primary text-xs py-1.5"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Accepteren
                        </button>
                      )}
                      {a.status === 'in_progress' && (
                        <button
                          onClick={() => updateStatus(a.id, 'completed')}
                          disabled={loading === a.id}
                          className="btn-primary text-xs py-1.5"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Markeer als afgerond
                        </button>
                      )}
                      {(a.status === 'open' || a.status === 'in_progress') && (
                        <button
                          onClick={() => updateStatus(a.id, 'cancelled')}
                          disabled={loading === a.id}
                          className="btn-secondary text-xs py-1.5 text-red-500 hover:bg-red-50"
                        >
                          Weigeren
                        </button>
                      )}
                      {(a.status === 'completed' || a.status === 'cancelled') && (
                        <span className="text-xs text-gray-400">Geen acties meer mogelijk</span>
                      )}
                    </div>
                  ) : (
                    /* ── PROPOSED (partner → admin): admin approves; partner can only withdraw ── */
                    <div className="flex gap-2 flex-wrap items-center">
                      {a.status === 'open' && (
                        <>
                          <span className="text-xs text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5">
                            Wacht op goedkeuring door NextGenMedia
                          </span>
                          <button
                            onClick={() => updateStatus(a.id, 'cancelled')}
                            disabled={loading === a.id}
                            className="btn-secondary text-xs py-1.5 text-red-500 hover:bg-red-50"
                          >
                            Voorstel intrekken
                          </button>
                        </>
                      )}
                      {a.status === 'in_progress' && (
                        <>
                          <span className="text-xs text-green-700 bg-green-50 rounded-lg px-2.5 py-1.5">
                            Goedgekeurd — in uitvoering
                          </span>
                          <button
                            onClick={() => updateStatus(a.id, 'completed')}
                            disabled={loading === a.id}
                            className="btn-primary text-xs py-1.5"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Markeer als afgerond
                          </button>
                        </>
                      )}
                      {a.status === 'completed' && (
                        <span className="text-xs text-gray-400">Afgerond</span>
                      )}
                      {a.status === 'cancelled' && (
                        <span className="text-xs text-gray-400">Ingetrokken / geweigerd</span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}

      {showSubmit && (
        <SubmitWorkDialog
          hourlyRate={hourlyRate}
          onClose={() => setShowSubmit(false)}
          onCreated={(a) => {
            setAssignments((prev) => [a, ...prev])
            setShowSubmit(false)
            setTab('proposed')
          }}
        />
      )}
    </div>
  )
}
