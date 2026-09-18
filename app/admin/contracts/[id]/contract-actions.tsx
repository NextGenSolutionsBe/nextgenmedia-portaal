'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Send, X, Loader2, Trash2, AlertTriangle } from 'lucide-react'

export function ContractActions({
  contract,
}: {
  contract: { id: string; status: string; access_token: string }
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const doAction = async (action: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/contracts/${contract.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fout')
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/admin/contracts/${contract.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: contract.status === 'signed' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      // Hard reload — guaranteed fresh contracts list without any stale entry
      window.location.href = '/admin/contracts'
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Fout bij verwijderen')
      setDeleting(false)
    }
  }

  return (
    <>
      <div className="card-base space-y-2">
        <h2 className="font-semibold text-sm">Acties</h2>

        {contract.status === 'draft' && (
          <button
            disabled={loading}
            onClick={() => doAction('send')}
            className="btn-primary w-full"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Versturen naar klant
          </button>
        )}

        {['draft', 'sent', 'viewed'].includes(contract.status) && (
          <button
            disabled={loading}
            onClick={() => { if (confirm('Contract annuleren?')) doAction('cancel') }}
            className="btn-secondary w-full"
          >
            <X className="h-4 w-4" />
            Annuleren
          </button>
        )}

        {contract.status === 'sent' || contract.status === 'viewed' ? (
          <p className="text-xs text-gray-400 text-center">
            Wachten op handtekening van klant
          </p>
        ) : null}

        {/* Delete — always available */}
        <button
          onClick={() => setDeleteOpen(true)}
          className="btn-danger w-full mt-1"
        >
          <Trash2 className="h-4 w-4" />
          Contract verwijderen
        </button>
      </div>

      {/* Delete confirmation modal */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center gap-2 p-5 border-b border-gray-100">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
              <h3 className="font-semibold text-gray-900">Contract verwijderen</h3>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-gray-700">
                Het contract wordt permanent verwijderd uit de database, inclusief het PDF-bestand.
                {contract.status === 'signed' && (
                  <span className="block mt-1 text-red-600 font-medium">
                    Let op: dit is een ondertekend contract.
                  </span>
                )}
              </p>

              {deleteError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {deleteError}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  className="btn-danger flex-1"
                >
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  Verwijderen
                </button>
                <button
                  onClick={() => { setDeleteOpen(false); setDeleteError(null) }}
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
