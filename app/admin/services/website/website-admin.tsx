'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Globe, Clock, CheckCircle2, X, Loader2, XCircle, Archive, Trash2, AlertTriangle, Inbox } from 'lucide-react'
import {
  formatDate,
  WEBDESIGN_STATUS_STYLE as STATUS_STYLE,
  WEBDESIGN_STATUS_LABEL as STATUS_LABEL,
  WEBDESIGN_KIND_LABEL as KIND_LABEL,
  resolveFriendlyKind,
  cleanDescription,
} from '@/lib/utils'

type Request = {
  id: string; title: string; description: string | null; kind: string;
  categories?: string[] | null;
  status: string; image_urls: string[]; admin_notes: string | null;
  created_at: string; updated_at: string;
  clients: { id: string; company_name: string } | null;
}
type Client = { id: string; company_name: string; active: boolean }

const isOpenStatus = (s: string) => s === 'new' || s === 'in_progress'

type Filter = 'open' | 'rejected' | 'done' | 'archived'

export function WebsiteAdmin({
  initialRequests, clients,
}: {
  initialRequests: Request[]
  clients: Client[]
}) {
  const router = useRouter()
  const [requests, setRequests] = useState(initialRequests)
  const [selected, setSelected] = useState<Request | null>(null)
  const [filter, setFilter] = useState<Filter>('open')
  const [busy, setBusy] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState<Request | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Compute filtered list + bucket counts in one pass — recomputed only when
  // the underlying requests array or active filter changes.
  const { counts, filtered } = useMemo(() => {
    const counts = { open: 0, rejected: 0, done: 0, archived: 0 }
    const filtered: Request[] = []
    for (const r of requests) {
      if (isOpenStatus(r.status)) counts.open++
      else if (r.status === 'rejected') counts.rejected++
      else if (r.status === 'done') counts.done++
      else if (r.status === 'archived') counts.archived++

      const matches = filter === 'open' ? isOpenStatus(r.status) : r.status === filter
      if (matches) filtered.push(r)
    }
    return { counts, filtered }
  }, [requests, filter])

  const updateStatus = async (id: string, status: string) => {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/webdesign', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, status }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setRequests(prev => prev.map(r => r.id === id ? { ...r, status } : r))
      if (selected?.id === id) setSelected(s => s ? { ...s, status } : s)
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fout')
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (!deleteOpen) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/webdesign?id=${deleteOpen.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setRequests(prev => prev.filter(r => r.id !== deleteOpen.id))
      if (selected?.id === deleteOpen.id) setSelected(null)
      setDeleteOpen(null)
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fout bij verwijderen')
    } finally {
      setDeleting(false)
    }
  }

  const FilterBtn = ({ value, label, count }: { value: Filter; label: string; count: number }) => (
    <button
      onClick={() => setFilter(value)}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        filter === value ? 'bg-black text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
      }`}
    >
      {label} ({count})
    </button>
  )

  return (
    <div className="space-y-4">
      {/* Websiteklanten — toont ALLE klanten met webdesign-dienst (actief + inactief) */}
      {clients.length > 0 && (
        <div className="card-base">
          <h2 className="font-semibold mb-3">Websiteklanten ({clients.length})</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {clients.map((c) => (
              <div key={c.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-2 min-w-0">
                  <Globe className="h-4 w-4 text-gray-400 shrink-0" />
                  <div className="font-medium text-sm truncate">{c.company_name}</div>
                </div>
                <span className={`status-badge text-xs shrink-0 ${c.active ? 'bg-green-100 text-green-700' : 'bg-gray-200 text-gray-700'}`}>
                  {c.active ? 'Actief' : 'Wacht op toegang'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status filters */}
      <div className="flex items-center gap-2 flex-wrap">
        <FilterBtn value="open" label="Open" count={counts.open} />
        <FilterBtn value="rejected" label="Afgewezen" count={counts.rejected} />
        <FilterBtn value="done" label="Afgerond" count={counts.done} />
        <FilterBtn value="archived" label="Gearchiveerd" count={counts.archived} />
      </div>

      <div className="flex flex-col lg:flex-row gap-4">
        {/* List */}
        <div className="flex-1 bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
          {filtered.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <Inbox className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p className="text-sm">Geen aanvragen in deze status</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {filtered.map((r) => {
                const friendlyKind = resolveFriendlyKind(r)
                return (
                  <button
                    key={r.id}
                    onClick={() => setSelected(r)}
                    className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${selected?.id === r.id ? 'bg-yellow-50' : ''}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm truncate">{r.title}</div>
                        <div className="text-xs text-gray-400 mt-0.5">
                          {r.clients?.company_name ?? '—'} · {KIND_LABEL[friendlyKind] ?? friendlyKind} · {formatDate(r.created_at)}
                        </div>
                      </div>
                      <span className={`status-badge shrink-0 ${STATUS_STYLE[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABEL[r.status] ?? r.status}
                      </span>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Detail panel — mobile: full-screen overlay; desktop: sidebar */}
        {selected && (() => {
          const selectedKind = resolveFriendlyKind(selected)
          const selectedDescription = cleanDescription(selected.description)
          return (
          <div className="lg:w-80 w-full bg-white border border-gray-200 rounded-xl shadow-sm h-fit lg:sticky lg:top-6">
            <div className="flex items-center justify-between p-4 border-b border-gray-100">
              <h3 className="font-semibold text-sm">Detail</h3>
              <button onClick={() => setSelected(null)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <div className="text-xs text-gray-500 mb-1">Klant</div>
                <div className="font-medium text-sm">{selected.clients?.company_name ?? '—'}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Soort</div>
                <div className="text-sm">{KIND_LABEL[selectedKind] ?? selectedKind}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Titel</div>
                <div className="text-sm font-medium">{selected.title}</div>
              </div>
              {selectedDescription && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Omschrijving</div>
                  <div className="text-sm text-gray-700 whitespace-pre-wrap">{selectedDescription}</div>
                </div>
              )}
              {selected.image_urls?.length > 0 && (
                <div>
                  <div className="text-xs text-gray-500 mb-1">Afbeeldingen</div>
                  <div className="grid grid-cols-2 gap-1">
                    {selected.image_urls.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="w-full h-16 object-cover rounded-lg border border-gray-200" />
                      </a>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t border-gray-100 pt-3 space-y-2">
                {/* Status actions — depending on current status */}
                {selected.status === 'new' && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => updateStatus(selected.id, 'in_progress')}
                      className="btn-secondary w-full text-xs"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Clock className="h-3.5 w-3.5" />}
                      In behandeling nemen
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => updateStatus(selected.id, 'rejected')}
                      className="btn-secondary w-full text-xs text-red-600 hover:border-red-300"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Afwijzen
                    </button>
                  </>
                )}
                {selected.status === 'in_progress' && (
                  <>
                    <button
                      disabled={busy}
                      onClick={() => updateStatus(selected.id, 'done')}
                      className="btn-primary w-full text-xs"
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                      Markeer als afgerond
                    </button>
                    <button
                      disabled={busy}
                      onClick={() => updateStatus(selected.id, 'rejected')}
                      className="btn-secondary w-full text-xs text-red-600 hover:border-red-300"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Afwijzen
                    </button>
                  </>
                )}
                {(selected.status === 'done' || selected.status === 'rejected') && (
                  <button
                    disabled={busy}
                    onClick={() => updateStatus(selected.id, 'archived')}
                    className="btn-secondary w-full text-xs"
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archiveren
                  </button>
                )}
                {selected.status === 'archived' && (
                  <button
                    disabled={busy}
                    onClick={() => updateStatus(selected.id, 'new')}
                    className="btn-secondary w-full text-xs"
                  >
                    Heropenen
                  </button>
                )}

                {/* Delete is always available */}
                <button
                  disabled={busy}
                  onClick={() => setDeleteOpen(selected)}
                  className="btn-secondary w-full text-xs text-red-600 hover:border-red-300"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Permanent verwijderen
                </button>
              </div>
            </div>
          </div>
          )
        })()}
      </div>

      {/* Delete confirmation modal */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center gap-2 p-5 border-b border-gray-100">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
              <h3 className="font-semibold text-gray-900">Aanvraag verwijderen</h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-700">
                De aanvraag <strong>{deleteOpen.title}</strong> wordt permanent verwijderd, inclusief eventuele afbeeldingen. Deze actie kan niet ongedaan worden gemaakt.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={doDelete}
                  disabled={deleting}
                  className="btn-danger flex-1"
                >
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Verwijderen
                </button>
                <button onClick={() => setDeleteOpen(null)} className="btn-secondary">
                  Annuleer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
