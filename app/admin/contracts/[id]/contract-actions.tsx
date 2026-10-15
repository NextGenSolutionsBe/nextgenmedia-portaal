'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Send, X, Loader2, Trash2, AlertTriangle } from 'lucide-react'

type VerwijderInfo = { titel: string; klant: string | null; facturen: number; recurring: number; opdrachten: number; vesting: number; archief: number }

export function ContractActions({
  contract,
}: {
  contract: { id: string; status: string; access_token: string; title?: string | null; clientName?: string | null }
}) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [info, setInfo] = useState<VerwijderInfo | null>(null)
  const [infoLaden, setInfoLaden] = useState(false)
  const isSigned = contract.status === 'signed' || contract.status === 'getekend'

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
      toast.error(err instanceof Error ? err.message : 'Fout')
    } finally {
      setLoading(false)
    }
  }

  const openDelete = async () => {
    setDeleteOpen(true)
    setDeleteError(null)
    setInfoLaden(true)
    try {
      const res = await fetch(`/api/admin/contracts/${contract.id}/verwijder-info`, { cache: 'no-store' })
      const j = await res.json().catch(() => ({}))
      if (res.ok) setInfo(j as VerwijderInfo)
    } catch { /* de modal toont dan enkel titel/klant uit de props */ }
    finally { setInfoLaden(false) }
  }

  const handleDelete = async () => {
    if (deleting) return   // geen dubbele acties
    setDeleting(true)
    setDeleteError(null)
    try {
      const res = await fetch(`/api/admin/contracts/${contract.id}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: isSigned }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Verwijderen mislukt')
      const los = json.losgekoppeld as { facturen?: number; recurring?: number } | undefined
      const nFact = (los?.facturen ?? 0) + (los?.recurring ?? 0)
      toast.success(`Contract "${info?.titel ?? contract.title ?? ''}" verwijderd.${nFact > 0 ? ` ${nFact} factu${nFact === 1 ? 'ur blijft' : 'ren blijven'} behouden als losse factu${nFact === 1 ? 'ur' : 'ren'}.` : ''}`)
      setDeleteOpen(false)
      router.push('/admin/contracts')
      router.refresh()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Fout bij verwijderen')
      setDeleting(false)
    }
  }

  const titel = info?.titel ?? contract.title ?? 'dit contract'
  const klant = info?.klant ?? contract.clientName ?? null
  const nFacturen = (info?.facturen ?? 0) + (info?.recurring ?? 0)

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

        {/* Verwijderen — altijd beschikbaar voor een bevoegde gebruiker */}
        <button
          type="button"
          onClick={openDelete}
          disabled={deleting}
          className="btn-danger w-full mt-1"
        >
          <Trash2 className="h-4 w-4" />
          Contract verwijderen
        </button>
      </div>

      {/* Bevestigingsvenster */}
      {deleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="verwijder-titel">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center gap-2 p-5 border-b border-gray-100">
              <AlertTriangle className="h-5 w-5 text-red-500 shrink-0" />
              <h3 id="verwijder-titel" className="font-semibold text-gray-900">Contract verwijderen</h3>
            </div>
            <div className="p-5 space-y-4">
              <div className="rounded-xl bg-gray-50 border border-gray-100 px-3 py-2 text-sm">
                <div className="font-medium text-gray-900 break-words">{titel}</div>
                {klant && <div className="text-xs text-gray-500 mt-0.5">{klant}</div>}
                {infoLaden && <div className="text-xs text-gray-400 mt-1 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" /> Gekoppelde gegevens controleren…</div>}
              </div>

              <p className="text-sm text-gray-700">
                Het contract wordt permanent verwijderd, inclusief de tijdlijn en het PDF-bestand.
                {isSigned && (
                  <span className="block mt-1 text-red-600 font-medium">
                    Let op: dit is een ondertekend contract. De getekende versie en het certificaat blijven bewaard in het beschermde contractarchief.
                  </span>
                )}
              </p>

              {nFacturen > 0 && (
                <div className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
                  Dit contract heeft {nFacturen} gekoppelde factu{nFacturen === 1 ? 'ur' : 'ren'}. Het contract wordt verwijderd, maar de facturen blijven behouden als losse facturen.
                </div>
              )}

              {deleteError && (
                <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
                  {deleteError}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deleting || infoLaden}
                  className="btn-danger flex-1"
                >
                  {deleting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {deleting ? 'Bezig met verwijderen…' : 'Definitief verwijderen'}
                </button>
                <button
                  type="button"
                  onClick={() => { if (!deleting) { setDeleteOpen(false); setDeleteError(null) } }}
                  disabled={deleting}
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
