'use client'

import { useEffect, useState, useCallback } from 'react'
import { RefreshCw, Loader2, Check, AlertTriangle } from 'lucide-react'

type Status = { configured: boolean; enabled: boolean; linked: boolean; syncedCount: number }
type Totals = { total: number; created: number; updated: number; skipped: number; failed: number; fieldLimited: number; deleted: number }
type SyncResult = { summary: Totals; errors: Array<{ id: string; title: string; error: string }> }

/** Lees een Response veilig: parse JSON, of geef een nette fout bij niet-JSON
 *  (bv. een platform-500/timeout die HTML/tekst teruggeeft). */
async function readResult(res: Response): Promise<{ ok: boolean; data: any }> {
  const text = await res.text()
  let data: any = null
  try { data = text ? JSON.parse(text) : {} } catch {
    data = { error: `Serverfout (${res.status} ${res.statusText}). ${text.slice(0, 120)}`.trim() }
  }
  return { ok: res.ok, data }
}

export function ClickUpSyncControl({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [toggling, setToggling] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [result, setResult] = useState<SyncResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const base = `/api/admin/clients/${clientId}/clickup-sync`

  const load = useCallback(async () => {
    try {
      const res = await fetch(base)
      const { ok, data } = await readResult(res)
      if (ok) setStatus(data)
    } catch { /* stil */ }
  }, [base])

  useEffect(() => { setStatus(null); setResult(null); setError(null); setProgress(null); load() }, [load])

  const toggle = async () => {
    if (!status) return
    setToggling(true); setError(null)
    try {
      const res = await fetch(base, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !status.enabled }),
      })
      const { ok, data } = await readResult(res)
      if (!ok) throw new Error(data.error || 'Wijzigen mislukt')
      setStatus((s) => (s ? { ...s, enabled: data.enabled } : s))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fout')
    } finally { setToggling(false) }
  }

  const sync = async () => {
    setSyncing(true); setError(null); setResult(null); setProgress('Synchroniseren…')
    // Cumulatief over de batches (de server werkt in tijdsbudgetten en kan
    // 'done: false' teruggeven; dan lopen we automatisch door).
    const acc: Totals = { total: 0, created: 0, updated: 0, skipped: 0, failed: 0, fieldLimited: 0, deleted: 0 }
    const allErrors: SyncResult['errors'] = []
    try {
      for (let i = 0; i < 120; i++) {
        const res = await fetch(base, { method: 'POST' })
        const { ok, data } = await readResult(res)
        if (!ok) throw new Error(data.error || 'Sync mislukt')
        const s: Totals = data.summary
        acc.total = s.total
        acc.created += s.created
        acc.updated += s.updated
        acc.failed += s.failed
        acc.fieldLimited += s.fieldLimited ?? 0
        acc.deleted += s.deleted ?? 0
        acc.skipped = s.skipped
        if (Array.isArray(data.errors)) allErrors.push(...data.errors)
        setProgress(`Synchroniseren… ${acc.created + acc.updated} verwerkt`)
        if (data.done) break
      }
      setResult({ summary: acc, errors: allErrors.slice(0, 25) })
      load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fout')
    } finally { setSyncing(false); setProgress(null) }
  }

  if (!status) return null

  if (!status.configured) {
    return (
      <div className="text-xs text-gray-400 flex items-center gap-1.5">
        <AlertTriangle className="h-3.5 w-3.5" />
        ClickUp niet geconfigureerd
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center gap-3 flex-wrap">
        {/* Aan/uit toggle */}
        <button
          type="button"
          onClick={toggle}
          disabled={toggling}
          className="inline-flex items-center gap-2 text-sm"
          title="ClickUp-sync aan/uit voor deze klant"
        >
          <span
            className={`relative h-5 w-9 rounded-full transition-colors ${status.enabled ? 'bg-[#c5b800]' : 'bg-gray-300'}`}
          >
            <span
              className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${status.enabled ? 'left-[18px]' : 'left-0.5'}`}
            />
          </span>
          <span className="text-gray-600">ClickUp-sync {status.enabled ? 'aan' : 'uit'}</span>
        </button>

        {/* Sync-knop */}
        <button
          type="button"
          onClick={sync}
          disabled={syncing || !status.enabled}
          className="btn-secondary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
          title={status.enabled ? 'Contentkalender naar ClickUp synchroniseren' : 'Zet eerst de sync aan'}
        >
          {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync met ClickUp
        </button>

        {syncing && progress && (
          <span className="text-xs text-gray-500">{progress}</span>
        )}
        {!syncing && status.syncedCount > 0 && (
          <span className="text-xs text-gray-400">{status.syncedCount} gekoppeld</span>
        )}
      </div>

      {error && (
        <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>
      )}

      {result && (
        <div className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 space-y-1">
          <div className="flex items-center gap-1.5 font-medium text-gray-700">
            <Check className="h-3.5 w-3.5 text-green-600" />
            Sync klaar — {result.summary.created} nieuw · {result.summary.updated} bijgewerkt · {result.summary.skipped} ongewijzigd
            {result.summary.deleted > 0 && <span> · {result.summary.deleted} verwijderd</span>}
            {result.summary.failed > 0 && <span className="text-red-600"> · {result.summary.failed} mislukt</span>}
          </div>
          {result.summary.fieldLimited > 0 && (
            <div className="flex items-start gap-1.5 text-amber-700">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Bij {result.summary.fieldLimited} {result.summary.fieldLimited === 1 ? 'taak' : 'taken'} konden de
                custom velden (Caption/Channel/Datum) niet ingesteld worden — ClickUp-planlimiet bereikt. De taken
                zelf (titel, status, datum) zijn wél gesynchroniseerd.
              </span>
            </div>
          )}
          {result.errors.length > 0 && (
            <ul className="text-red-600 list-disc pl-4 space-y-0.5">
              {result.errors.slice(0, 5).map((e) => (
                <li key={e.id} className="truncate">{e.title}: {e.error}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
