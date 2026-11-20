'use client'

import { useState } from 'react'
import { Trash2, X, Loader2, AlertTriangle, FileText } from 'lucide-react'

type Info = { contracten: { id: string; titel: string; status: string; getekend_op: string | null }[]; facturen: number }

const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' }) : null)

/**
 * Klant permanent verwijderen. Eerst zie je wat er mee weggaat: elk contract
 * met titel en status. Heeft de klant contracten, dan vink je ook nog aan dat
 * die mee verwijderd worden (de server weigert anders).
 */
export function DeleteClientButton({ clientId, companyName }: { clientId: string; companyName: string }) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<Info | null>(null)
  const [laden, setLaden] = useState(false)
  const [contractenOk, setContractenOk] = useState(false)

  const naamOk = input.trim().toLowerCase() === companyName.trim().toLowerCase()
  const heeftContracten = (info?.contracten.length ?? 0) > 0
  const confirmed = naamOk && !!info && (!heeftContracten || contractenOk)

  const openen = async () => {
    setOpen(true); setInfo(null); setContractenOk(false); setError(null); setLaden(true)
    try {
      const r = await fetch(`/api/admin/clients/${clientId}/verwijder-info`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Kon niet nagaan wat er mee verwijderd wordt.')
      setInfo(j)
    } catch (e) { setError(e instanceof Error ? e.message : 'Kon niet nagaan wat er mee verwijderd wordt.') } finally { setLaden(false) }
  }
  const sluiten = () => { setOpen(false); setInput(''); setContractenOk(false) }

  const handleDelete = async () => {
    if (!confirmed || !info) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/clients/${clientId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed_name: input, contracten_bevestigd: info.contracten.map((c) => c.id) }),
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
      <button onClick={openen} className="btn-danger flex items-center gap-2">
        <Trash2 className="h-4 w-4" />
        Klant verwijderen
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <h3 className="font-semibold text-gray-900">Klant permanent verwijderen</h3>
              </div>
              <button onClick={sluiten} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {laden && <p className="text-sm text-gray-500 flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />Nagaan wat er mee verwijderd wordt…</p>}

              {info && heeftContracten && (
                <div className="bg-red-50 border border-red-300 rounded-xl p-4 space-y-3">
                  <p className="text-sm text-red-900 font-semibold">
                    Ben je heel zeker? {companyName} heeft {info.contracten.length === 1 ? 'een contract' : `${info.contracten.length} contracten`}. {info.contracten.length === 1 ? 'Dat wordt' : 'Die worden'} mee verwijderd uit de app:
                  </p>
                  <ul className="space-y-1.5">
                    {info.contracten.map((c) => (
                      <li key={c.id} className="flex items-start gap-2 text-sm text-red-900">
                        <FileText className="h-4 w-4 mt-0.5 shrink-0" />
                        <span><span className="font-medium">{c.titel}</span> <span className="text-red-700">· {c.status}{c.getekend_op ? ` op ${datum(c.getekend_op)}` : ''}</span></span>
                      </li>
                    ))}
                  </ul>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={contractenOk} onChange={(e) => setContractenOk(e.target.checked)} className="mt-0.5 h-4 w-4 accent-red-600" />
                    <span className="text-sm text-red-900">Ja, verwijder {info.contracten.length === 1 ? 'dit contract' : `deze ${info.contracten.length} contracten`} mee.</span>
                  </label>
                </div>
              )}

              {info && (
                <div className="bg-red-50 border border-red-200 rounded-xl p-4">
                  <p className="text-sm text-red-800 font-medium">
                    Dit verwijdert de klant permanent uit de database.
                  </p>
                  <p className="text-xs text-red-600 mt-1">
                    {heeftContracten ? 'De contracten hierboven, de' : 'De'} diensten, content en omzetgegevens van deze klant gaan mee weg.
                    {info.facturen > 0 ? ` De ${info.facturen === 1 ? 'factuur blijft' : `${info.facturen} facturen blijven`} bestaan, maar los van de klant.` : ''}
                    {' '}Deze actie kan <strong>niet ongedaan</strong> worden gemaakt.
                  </p>
                </div>
              )}

              {info && (
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
              )}

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
                <button onClick={sluiten} className="btn-secondary">
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
