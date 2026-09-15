'use client'

import { useState } from 'react'
import { Trash2, X, Loader2, AlertTriangle } from 'lucide-react'

export function DeleteClientButton({ clientId, companyName }: { clientId: string; companyName: string }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmed = input.trim().toLowerCase() === companyName.trim().toLowerCase()

  const handleDelete = async () => {
    if (!confirmed) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed_name: input }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      // Hard reload — bypasses Router Cache so the clients list is guaranteed fresh
      window.location.href = '/admin/clients'
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout bij verwijderen')
      setLoading(false)
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-danger flex items-center gap-2">
        <Trash2 className="h-4 w-4" />
        Klant verwijderen
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <h3 className="font-semibold text-gray-900">Klant permanent verwijderen</h3>
              </div>
              <button onClick={() => { setOpen(false); setInput('') }}
                className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                <p className="text-sm text-red-800 font-medium">
                  Dit verwijdert de klant permanent uit de database.
                </p>
                <p className="text-xs text-red-600 mt-1">
                  Alle contracten, diensten, content en omzetgegevens van deze klant worden ook verwijderd.
                  Deze actie kan <strong>niet ongedaan</strong> worden gemaakt.
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Typ de bedrijfsnaam ter bevestiging:
                  <span className="font-bold ml-1">{companyName}</span>
                </label>
                <input
                  type="text"
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder={companyName}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-300 focus:border-red-400"
                  autoFocus
                />
              </div>

              {error && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  disabled={!confirmed || loading}
                  className="btn-danger flex-1 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                  Permanent verwijderen
                </button>
                <button onClick={() => { setOpen(false); setInput('') }} className="btn-secondary">
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
