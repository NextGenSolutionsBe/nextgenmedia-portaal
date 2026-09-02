'use client'

import { useState, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ContentCalendar, type SocialContentItem, type SocialContentStatus } from '@/components/calendar/content-calendar'
import { Plus, X, Loader2, Sparkles, CheckSquare, Trash2, AlertTriangle, CalendarRange, ArrowRight, History } from 'lucide-react'
import { GenerateDialog } from './generate-dialog'
import { ClickUpSyncControl } from '@/components/admin/clickup-sync-control'
import { ShootBriefings } from '@/components/admin/shoot-briefings'
import { SendMailButton } from '@/components/admin/send-mail-button'
import { KANAAL_SLUGS, kanaalLabel } from '@/lib/social-platforms'

type Client = { id: string; company_name: string }

// Eén bron voor de kanalen; Meta vervangt Instagram + Facebook.
const PLATFORMS = KANAAL_SLUGS
const TYPES = ['post', 'reel', 'story', 'carousel']

function CreateDialog({
  clientId,
  defaultDate,
  onClose,
  onCreated,
}: {
  clientId: string
  defaultDate?: string
  onClose: () => void
  onCreated: (item: SocialContentItem) => void
}) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({
    title: '',
    platforms: ['meta'] as string[],
    content_type: 'post',
    planned_date: defaultDate || new Date().toISOString().slice(0, 10),
    caption: '',
    script: '',
    media_notes: '',
    status: 'draft' as SocialContentStatus,
  })

  const togglePlatform = (p: string) =>
    setForm((prev) => {
      const next = prev.platforms.includes(p)
        ? prev.platforms.filter((x) => x !== p)
        : [...prev.platforms, p]
      return { ...prev, platforms: next.length > 0 ? next : [p] }
    })

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const res = await fetch('/api/admin/social-content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          platform: form.platforms[0],
          clientId,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      onCreated({
        id: json.id,
        client_id: clientId,
        ...form,
        platform: form.platforms[0],
        caption: form.caption || null,
        script: form.script || null,
        media_notes: form.media_notes || null,
        client_feedback: null,
        reviewed_at: null,
        created_at: new Date().toISOString(),
      } as unknown as SocialContentItem)
      onClose()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fout')
    } finally {
      setLoading(false)
    }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Nieuw content-item</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleCreate} className="p-5 space-y-4">
          <div>
            <label className={lbl}>Titel *</label>
            <input required className={inp} value={form.title} onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} placeholder="Bijv. Zomercampagne reel" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Datum</label>
              <input type="date" className={inp} value={form.planned_date} onChange={(e) => setForm((p) => ({ ...p, planned_date: e.target.value }))} />
            </div>
            <div>
              <label className={lbl}>Type</label>
              <select className={inp} value={form.content_type} onChange={(e) => setForm((p) => ({ ...p, content_type: e.target.value }))}>
                {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={lbl}>
              Kanalen <span className="font-normal text-gray-400">(meerdere mogelijk)</span>
            </label>
            <div className="flex flex-wrap gap-1.5 mt-1">
              {PLATFORMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => togglePlatform(p)}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                    form.platforms.includes(p)
                      ? 'border-[#fff848] bg-[#fff848]/10 text-black'
                      : 'border-gray-200 text-gray-500 hover:border-gray-300'
                  }`}
                >
                  {kanaalLabel(p)}
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={lbl}>Caption</label>
            <textarea rows={2} className={inp} value={form.caption} onChange={(e) => setForm((p) => ({ ...p, caption: e.target.value }))} placeholder="Caption text..." />
          </div>
          <div>
            <label className={lbl}>Script / Hook / CTA</label>
            <textarea rows={4} className={inp} value={form.script} onChange={(e) => setForm((p) => ({ ...p, script: e.target.value }))} placeholder="Script content..." />
          </div>
          <div>
            <label className={lbl}>Status</label>
            <select className={inp} value={form.status} onChange={(e) => setForm((p) => ({ ...p, status: e.target.value as SocialContentStatus }))}>
              <option value="draft">Concept</option>
              <option value="ready_for_review">Bij klant</option>
            </select>
          </div>
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading} className="btn-primary flex-1">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
              Aanmaken
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Annuleer</button>
          </div>
        </form>
      </div>
    </div>
  )
}

export function SocialMediaAdmin({
  clients, initialItems, initialClientId,
}: {
  clients: { id: string; company_name: string }[]
  initialItems: Array<{
    id: string; client_id: string; planned_date: string; platform: string;
    platforms: string[]; content_type: string; title: string;
    caption: string | null; script: string | null;
    media_notes: string | null; status: string; client_feedback: string | null;
    reviewed_at: string | null; created_at: string;
  }>
  initialClientId?: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selectedClient, setSelectedClient] = useState(initialClientId || (clients[0]?.id ?? ''))
  const [items, setItems] = useState<SocialContentItem[]>(initialItems as unknown as SocialContentItem[])
  const [createDialog, setCreateDialog] = useState<{ open: boolean; date?: string }>({ open: false })
  const [showGenerate, setShowGenerate] = useState(false)
  const [loading, setLoading] = useState(false)

  // Bulk-select state
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleteInput, setBulkDeleteInput] = useState('')
  const [bulkDeleting, setBulkDeleting] = useState(false)

  // Maand verzetten (hele maand content van X → Y)
  const thisMonth = () => new Date().toISOString().slice(0, 7)
  const nextMonthStr = () => { const d = new Date(); d.setMonth(d.getMonth() + 1); return d.toISOString().slice(0, 7) }
  const [shiftOpen, setShiftOpen] = useState(false)
  const [shiftFrom, setShiftFrom] = useState(thisMonth)
  const [shiftTo, setShiftTo] = useState(nextMonthStr)
  const [shifting, setShifting] = useState(false)

  const toggleSelected = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const clearSelection = () => {
    setSelectedIds(new Set())
    setSelectMode(false)
  }

  const doBulkDelete = async () => {
    if (bulkDeleteInput.trim().toUpperCase() !== 'VERWIJDEREN') return
    if (selectedIds.size === 0) return
    setBulkDeleting(true)
    try {
      const ids = Array.from(selectedIds)
      const res = await fetch('/api/admin/social-content', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      // Optimistic UI update — remove deleted items from local state
      setItems(prev => prev.filter(it => !selectedIds.has(it.id)))
      setBulkDeleteOpen(false)
      setBulkDeleteInput('')
      clearSelection()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fout bij bulk verwijderen')
    } finally {
      setBulkDeleting(false)
    }
  }

  const monthLabel = (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    if (!y || !m) return ym
    return new Date(y, m - 1, 1).toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' })
  }

  const doShift = async () => {
    if (shiftFrom === shiftTo) return
    setShifting(true)
    try {
      const res = await fetch('/api/admin/social-content/shift-month', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: selectedClient, from: shiftFrom, to: shiftTo }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      await loadItems(selectedClient)
      setShiftOpen(false)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fout bij verzetten')
    } finally {
      setShifting(false)
    }
  }

  const loadItems = useCallback(async (clientId: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/social-content?clientId=${clientId}`)
      const json = await res.json()
      // Bij een fout de lijst NIET leegmaken (voorkomt schijnbaar "verdwenen"
      // content); enkel vervangen als de server echt items teruggeeft.
      if (res.ok && Array.isArray(json.items)) setItems(json.items)
      else if (!res.ok) alert(json.error || 'Kon content niet laden — probeer opnieuw.')
    } catch {
      alert('Kon content niet laden — controleer je verbinding en probeer opnieuw.')
    } finally {
      setLoading(false)
    }
  }, [])

  const handleClientChange = (id: string) => {
    setSelectedClient(id)
    loadItems(id)
    startTransition(() => {
      router.replace(`/admin/services/social-media?client=${id}`, { scroll: false })
    })
  }

  const handleUpdate = async (id: string, patch: Partial<SocialContentItem>) => {
    await fetch('/api/admin/social-content', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...patch }),
    })
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, ...patch } : it))
  }

  const handleMove = async (id: string, planned_date: string) => {
    await handleUpdate(id, { planned_date })
  }

  const handleSetStatus = async (id: string, status: SocialContentStatus) => {
    await fetch('/api/admin/social-content/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    setItems((prev) => prev.map((it) => it.id === id ? { ...it, status } : it))
  }

  const handleDelete = async (id: string) => {
    await fetch(`/api/admin/social-content?id=${id}`, { method: 'DELETE' })
    setItems((prev) => prev.filter((it) => it.id !== id))
  }

  const clientItems = items.filter((it) => it.client_id === selectedClient)
  const selectedClientData = clients.find((c) => c.id === selectedClient)

  return (
    <div className="space-y-4">
      {/* Client selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <select
            value={selectedClient}
            onChange={(e) => handleClientChange(e.target.value)}
            className="input-base max-w-xs"
          >
            <option value="">— Selecteer klant —</option>
            {clients.map((c) => (
              <option key={c.id} value={c.id}>{c.company_name}</option>
            ))}
          </select>
        </div>
        {selectedClient && (
          <div className="flex items-center gap-2 flex-wrap">
            {selectedClientData && (
              <div className="flex gap-3 text-xs text-gray-500">
                <span className="px-2 py-1 bg-gray-100 rounded-lg">{selectedClientData.company_name}</span>
              </div>
            )}
            {!selectMode ? (
              <>
                <SendMailButton clientId={selectedClient} kind="scripts" label="Verstuur mail" />
                <SendMailButton clientId={selectedClient} kind="shoot" label="Verstuur uitnodiging" />
                <button
                  onClick={() => { setShiftFrom(thisMonth()); setShiftTo(nextMonthStr()); setShiftOpen(true) }}
                  className="btn-secondary"
                  title="Een hele maand content verzetten naar een andere maand"
                >
                  <CalendarRange className="h-4 w-4" />
                  Verzetten
                </button>
                <a href="/admin/services/social-media/recover" className="btn-secondary" title="Verdwenen content terugvinden en herstellen">
                  <History className="h-4 w-4" />
                  Herstellen
                </a>
                <button
                  onClick={() => setSelectMode(true)}
                  className="btn-secondary"
                  title="Meerdere items selecteren om te verwijderen"
                >
                  <CheckSquare className="h-4 w-4" />
                  Selecteren
                </button>
                <button
                  onClick={() => setShowGenerate(true)}
                  className="btn-secondary"
                >
                  <Sparkles className="h-4 w-4" />
                  Content inplannen
                </button>
                <button
                  onClick={() => setCreateDialog({ open: true })}
                  className="btn-primary"
                >
                  <Plus className="h-4 w-4" />
                  Content toevoegen
                </button>
              </>
            ) : (
              <>
                <span className="text-sm text-gray-600 font-medium">
                  {selectedIds.size} geselecteerd
                </span>
                <button
                  onClick={() => setBulkDeleteOpen(true)}
                  disabled={selectedIds.size === 0}
                  className="btn-danger disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Trash2 className="h-4 w-4" />
                  Verwijderen ({selectedIds.size})
                </button>
                <button onClick={clearSelection} className="btn-secondary">
                  <X className="h-4 w-4" />
                  Annuleer
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {/* ClickUp-sync (per klant) */}
      {selectedClient && (
        <div className="card-base">
          <ClickUpSyncControl clientId={selectedClient} />
        </div>
      )}

      {/* Stats */}
      {selectedClient && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(['draft', 'ready_for_review', 'changes_requested', 'approved'] as SocialContentStatus[]).map((s) => {
            const count = clientItems.filter((it) => it.status === s).length
            const labels: Record<string, string> = {
              draft: 'Concept',
              ready_for_review: 'Bij klant',
              changes_requested: 'Feedback',
              approved: 'Goedgekeurd',
            }
            const colors: Record<string, string> = {
              draft: 'text-gray-600',
              ready_for_review: 'text-amber-600',
              changes_requested: 'text-red-600',
              approved: 'text-green-600',
            }
            return (
              <div key={s} className="bg-white border border-gray-200 rounded-xl p-3 text-center shadow-sm">
                <div className={`text-xl font-bold ${colors[s]}`}>{count}</div>
                <div className="text-xs text-gray-400 mt-0.5">{labels[s]}</div>
              </div>
            )
          })}
        </div>
      )}

      {/* Calendar */}
      {selectedClient ? (
        loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Laden...
          </div>
        ) : (
          <ContentCalendar
            items={clientItems}
            mode="admin"
            actions={{
              onUpdate: handleUpdate,
              onMove: handleMove,
              onSetStatus: handleSetStatus,
              onDelete: handleDelete,
              onCreateOnDay: (date) => setCreateDialog({ open: true, date }),
            }}
            selection={{
              enabled: selectMode,
              selectedIds,
              onToggle: toggleSelected,
            }}
          />
        )
      ) : (
        <div className="text-center py-16 text-gray-400">
          <p className="text-sm">Selecteer een klant om de contentkalender te bekijken</p>
        </div>
      )}

      {/* Shoot Briefing (per klant) */}
      {selectedClient && <ShootBriefings clientId={selectedClient} />}

      {/* Generate planning dialog */}
      {showGenerate && selectedClient && (
        <GenerateDialog
          clientId={selectedClient}
          onClose={() => setShowGenerate(false)}
          onGenerated={() => loadItems(selectedClient)}
        />
      )}

      {/* Create dialog */}
      {createDialog.open && selectedClient && (
        <CreateDialog
          clientId={selectedClient}
          defaultDate={createDialog.date}
          onClose={() => setCreateDialog({ open: false })}
          onCreated={(item) => {
            setItems((prev) => [...prev, item])
            setCreateDialog({ open: false })
            // Herlaad vanuit de server zodat de weergave exact de database volgt
            // (bevestigt dat het item écht bewaard is).
            loadItems(selectedClient)
          }}
        />
      )}

      {/* Bulk delete confirmation modal */}
      {bulkDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center gap-2 p-5 border-b border-gray-100">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
              <h3 className="font-semibold text-gray-900">{selectedIds.size} items verwijderen</h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm text-red-800 font-medium">
                  {selectedIds.size} content-items worden permanent verwijderd.
                </p>
                <p className="text-xs text-red-600 mt-1">
                  Deze actie kan niet ongedaan worden gemaakt.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Typ <span className="font-mono font-bold">VERWIJDEREN</span> ter bevestiging:
                </label>
                <input
                  type="text"
                  value={bulkDeleteInput}
                  onChange={e => setBulkDeleteInput(e.target.value)}
                  placeholder="VERWIJDEREN"
                  autoFocus
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400 font-mono"
                />
              </div>

              <div className="flex gap-2">
                <button
                  onClick={doBulkDelete}
                  disabled={bulkDeleting || bulkDeleteInput.trim().toUpperCase() !== 'VERWIJDEREN'}
                  className="btn-danger flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {bulkDeleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Permanent verwijderen
                </button>
                <button
                  onClick={() => { setBulkDeleteOpen(false); setBulkDeleteInput('') }}
                  className="btn-secondary"
                >
                  Annuleer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Maand verzetten modal */}
      {shiftOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="font-semibold text-gray-900 flex items-center gap-2">
                <CalendarRange className="h-5 w-5 text-gray-700" />
                Content verzetten
              </h3>
              <button onClick={() => setShiftOpen(false)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-500">
                Verzet alle content van één maand naar een andere maand. De dag van de maand blijft behouden.
              </p>
              <div className="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Van</label>
                  <input
                    type="month"
                    value={shiftFrom}
                    onChange={(e) => setShiftFrom(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]"
                  />
                </div>
                <ArrowRight className="h-4 w-4 text-gray-400 mb-2.5" />
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Naar</label>
                  <input
                    type="month"
                    value={shiftTo}
                    onChange={(e) => setShiftTo(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]"
                  />
                </div>
              </div>

              {(() => {
                const count = clientItems.filter((it) => (it.planned_date ?? '').slice(0, 7) === shiftFrom).length
                const sameMonth = shiftFrom === shiftTo
                return (
                  <>
                    <div className={`rounded-xl p-4 border text-sm ${
                      sameMonth ? 'bg-amber-50 border-amber-200 text-amber-800'
                      : count === 0 ? 'bg-gray-50 border-gray-200 text-gray-500'
                      : 'bg-[#fff848]/10 border-[#fff848] text-gray-800'
                    }`}>
                      {sameMonth ? (
                        'Kies een verschillende bron- en doelmaand.'
                      ) : count === 0 ? (
                        <>Geen content gevonden in <b className="capitalize">{monthLabel(shiftFrom)}</b>.</>
                      ) : (
                        <><b>{count}</b> {count === 1 ? 'item' : 'items'} van <b className="capitalize">{monthLabel(shiftFrom)}</b> worden verzet naar <b className="capitalize">{monthLabel(shiftTo)}</b>.</>
                      )}
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={doShift}
                        disabled={shifting || sameMonth || count === 0}
                        className="btn-primary flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {shifting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />}
                        Verzetten
                      </button>
                      <button onClick={() => setShiftOpen(false)} className="btn-secondary">Annuleer</button>
                    </div>
                  </>
                )
              })()}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
