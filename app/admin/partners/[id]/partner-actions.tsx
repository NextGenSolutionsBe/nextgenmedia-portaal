'use client'

import { useState } from 'react'
import { Trash2, X, Loader2, AlertTriangle, Power } from 'lucide-react'

export function PartnerActions({
  partnerId,
  partnerName,
  active,
}: {
  partnerId: string
  partnerName: string
  active: boolean
}) {
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [input, setInput] = useState('')
  const [hardDelete, setHardDelete] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toggling, setToggling] = useState(false)

  const confirmed = input.trim().toLowerCase() === partnerName.trim().toLowerCase()

  const toggleActive = async () => {
    setToggling(true)
    try {
      const res = await fetch(`/api/admin/partners/${partnerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ active: !active }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      window.location.reload()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fout')
      setToggling(false)
    }
  }

  const handleDelete = async () => {
    if (hardDelete && !confirmed) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/partners/${partnerId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hard: hardDelete }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      // Hard reload — guaranteed fresh partners list
      window.location.href = '/admin/partners'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout bij verwijderen')
      setLoading(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={toggleActive}
          disabled={toggling}
          className="btn-secondary text-sm"
          title={active ? 'Partner deactiveren' : 'Partner activeren'}
        >
          {toggling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
          {active ? 'Deactiveren' : 'Activeren'}
        </button>
        <button onClick={() => setDeleteOpen(true)} className="btn-danger text-sm">
          <Trash2 className="h-4 w-4" />
          Verwijderen
        </button>
      </div>

      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center gap-2 p-5 border-b border-gray-100">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
              <h3 className="font-semibold text-gray-900">Partner verwijderen</h3>
              <button
                onClick={() => { setDeleteOpen(false); setInput(''); setHardDelete(false); setError(null) }}
                className="ml-auto h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              {/* Soft delete option */}
              <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border border-gray-200 hover:border-gray-300">
                <input
                  type="radio"
                  checked={!hardDelete}
                  onChange={() => setHardDelete(false)}
                  className="mt-0.5 accent-gray-900"
                />
                <div>
                  <div className="text-sm font-medium text-gray-900">Deactiveren (aanbevolen)</div>
                  <div className="text-xs text-gray-500 mt-0.5">
                    De partner blijft bewaard maar wordt op inactief gezet. Historiek en afrekeningen blijven behouden.
                  </div>
                </div>
              </label>

              {/* Hard delete option */}
              <label className="flex items-start gap-3 cursor-pointer p-3 rounded-xl border border-red-200 hover:border-red-300">
                <input
                  type="radio"
                  checked={hardDelete}
                  onChange={() => setHardDelete(true)}
                  className="mt-0.5 accent-red-600"
                />
                <div>
                  <div className="text-sm font-medium text-red-700">Permanent verwijderen</div>
                  <div className="text-xs text-red-600 mt-0.5">
                    Verwijdert de partner, alle opdrachten, ledger-items en afrekeningen permanent. Kan niet ongedaan worden gemaakt.
                  </div>
                </div>
              </label>

              {hardDelete && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Typ de naam ter bevestiging: <span className="font-bold">{partnerName}</span>
                  </label>
                  <input
                    type="text"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder={partnerName}
                    autoFocus
                    className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
                  />
                </div>
              )}

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  disabled={loading || (hardDelete && !confirmed)}
                  className="btn-danger flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {hardDelete ? 'Permanent verwijderen' : 'Deactiveren'}
                </button>
                <button
                  onClick={() => { setDeleteOpen(false); setInput(''); setHardDelete(false); setError(null) }}
                  className="btn-secondary"
                >
                  Annuleer
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
