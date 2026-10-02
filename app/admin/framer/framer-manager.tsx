'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Loader2, Plug, Wand2, FlaskConical, ScrollText, Save, ExternalLink, CheckCircle2, AlertTriangle, Info } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils'

type Row = {
  id: string; company_name: string; connected: boolean; project_url: string | null
  collection_linked: boolean; framer_valid: boolean; missing: string[]; last_sync: string | null
  published: number; review: number; approved: number; failed: number; state: 'groen' | 'oranje' | 'rood'
}
type Stats = { linkedProjects: number; activeProjects: number; publishedToday: number; failedTotal: number; failedToday: number; readyToPublish: number }
type LogRow = { id: string; actie: string; status: string; foutmelding: string | null; created_at: string }

const STATE_DOT: Record<string, string> = { groen: 'bg-green-500', oranje: 'bg-amber-500', rood: 'bg-red-500' }
const FIELD_KEYS = ['titel', 'content', 'thumbnail', 'excerpt', 'datum'] as const

export function FramerManager() {
  const [rows, setRows] = useState<Row[]>([])
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/framer'); const j = await res.json()
      if (res.ok) { setRows(j.rows ?? []); setStats(j.stats) }
    } catch { /* stil */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-5">
      {/* Hoe werkt dit? */}
      <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-sky-900 mb-2"><Info className="h-4 w-4" />Hoe werkt dit?</div>
        <ol className="text-sm text-sky-900/90 space-y-1 list-decimal list-inside">
          <li>Vul bij de klant het <b>Framer project</b> en de <b>Framer toegangssleutel</b> in (klantdetail → Blogs).</li>
          <li>Klik hieronder op <b>Analyseer Framer project</b> — de app kiest automatisch de blogcollectie en koppelt de velden.</li>
          <li>Doe een <b>Test publicatie</b> om te bevestigen dat alles werkt.</li>
          <li>Blogs worden automatisch gegenereerd; je <b>keurt ze goed</b> om ze live te zetten.</li>
        </ol>
      </div>

      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <Kpi label="Gekoppelde projecten" value={stats.linkedProjects} />
          <Kpi label="Actieve projecten" value={stats.activeProjects} />
          <Kpi label="Publicaties vandaag" value={stats.publishedToday} />
          <Kpi label="Gefaald (totaal)" value={stats.failedTotal} />
          <Kpi label="Klaar voor publicatie" value={stats.readyToPublish} />
          <Kpi label="Gefaald vandaag" value={stats.failedToday} />
        </div>
      )}

      {loading ? (
        <div className="card-base text-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : rows.length === 0 ? (
        <div className="card-base empty-state"><Plug className="h-8 w-8 mx-auto mb-3 opacity-30" /><p className="text-sm">Nog geen klanten met blogs inbegrepen.</p></div>
      ) : (
        <div className="space-y-3">{rows.map((r) => <ClientCard key={r.id} row={r} onChanged={load} />)}</div>
      )}
    </div>
  )
}

function Kpi({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-gray-100 p-3"><div className="text-[11px] text-gray-500">{label}</div><div className="mt-0.5 text-xl font-bold">{value}</div></div>
}

function ClientCard({ row, onChanged }: { row: Row; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [collections, setCollections] = useState<{ id: string; name: string }[] | null>(null)
  const [fields, setFields] = useState<{ id: string; name: string; type: string }[] | null>(null)
  const [map, setMap] = useState<Record<string, string>>({})
  const [logs, setLogs] = useState<LogRow[] | null>(null)
  const [projectUrl, setProjectUrl] = useState(row.project_url ?? '')
  const [apiKey, setApiKey] = useState('')

  const call = async (action: string, extra?: object) => {
    setBusy(action)
    try {
      const res = await fetch('/api/admin/framer', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, account_id: row.id, ...extra }) })
      const j = await res.json(); if (!res.ok || j.ok === false) throw new Error(j.error || 'Mislukt')
      return j
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Fout'); return null } finally { setBusy(null) }
  }

  const saveSettings = async (patch: object, msg: string) => {
    setBusy('save')
    try {
      const res = await fetch('/api/admin/blog-accounts', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: row.id, ...patch }) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success(msg); onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }

  // Eén-klik: analyseer en configureer automatisch.
  const analyze = async () => {
    const j = await call('analyze')
    if (!j) return
    if (j.needsChoice) { setCollections(j.collections ?? []); toast.message('Meerdere collecties gevonden — kies de blogcollectie hieronder.'); return }
    if (j.detectedId && j.suggested) {
      const detName = (j.collections ?? []).find((c: { id: string; name: string }) => c.id === j.detectedId)?.name ?? 'blogcollectie'
      await saveSettings({ framer_blog_collection_id: j.detectedId, framer_field_map: j.suggested }, `Automatisch geconfigureerd ✓ (collectie: ${detName})`)
    } else {
      toast.error('Geen blogcollectie gevonden in dit project.')
    }
  }

  const testPublish = async () => { const j = await call('test_publish'); if (j) toast.success('Framer configuratie werkt — testitem aangemaakt en weer verwijderd.') }
  const getCollections = async () => { const j = await call('collections'); if (j) setCollections(j.collections ?? []) }
  const chooseCollection = async (id: string) => {
    await saveSettings({ framer_blog_collection_id: id }, 'Blogcollectie gekoppeld.')
    const j = await call('fields', { collection_id: id }); if (j) { setFields(j.fields ?? []); setMap(j.suggested ?? {}) }
  }
  const loadLogs = async () => {
    if (logs) { setLogs(null); return }
    setBusy('logs')
    try { const res = await fetch(`/api/admin/framer?logs=${row.id}`); const j = await res.json(); if (res.ok) setLogs(j.logs ?? []) } finally { setBusy(null) }
  }

  return (
    <div className="card-base">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium flex items-center gap-2 flex-wrap">
            <span className={`h-2.5 w-2.5 rounded-full ${STATE_DOT[row.state]}`} />{row.company_name}
            {row.state === 'groen' ? <span className="inline-flex items-center gap-1 text-[10px] text-green-700"><CheckCircle2 className="h-3 w-3" />Volledig geconfigureerd</span>
              : <span className="inline-flex items-center gap-1 text-[10px] text-amber-600"><AlertTriangle className="h-3 w-3" />Aandacht nodig</span>}
          </div>
          {row.missing.length > 0 && (
            <div className="mt-1 text-xs text-amber-700">Ontbreekt: {row.missing.join(' · ')}</div>
          )}
          <div className="text-xs text-gray-400 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>Verbonden: {row.connected ? 'ja' : 'nee'}</span>
            <span>Blogcollectie: {row.collection_linked ? 'gekoppeld' : 'nee'}</span>
            <span>Laatste sync: {row.last_sync ? formatDate(row.last_sync) : '—'}</span>
            {row.project_url && <a href={row.project_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">project <ExternalLink className="h-3 w-3" /></a>}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            <span className="status-badge bg-green-100 text-green-700">{row.published} gepubliceerd</span>
            <span className="status-badge bg-amber-100 text-amber-700">{row.review} review</span>
            {row.approved > 0 && <span className="status-badge bg-blue-100 text-blue-700">{row.approved} goedgekeurd</span>}
            {row.failed > 0 && <span className="status-badge bg-red-100 text-red-700">{row.failed} gefaald</span>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Link href={`/admin/blogs?account=${row.id}`} className="btn-secondary text-xs">Review</Link>
          <button onClick={() => setOpen((o) => !o)} className="btn-secondary text-xs">{open ? 'Sluiten' : 'Beheren'}</button>
        </div>
      </div>

      {open && (
        <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
          {/* Framer-toegang — enige plaats waar dit wordt ingesteld */}
          <div className="rounded-xl border border-gray-100 p-3 space-y-2">
            <div className="text-xs font-medium text-gray-600">Framer-toegang</div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Framer project</label>
              <input className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" value={projectUrl} onChange={(e) => setProjectUrl(e.target.value)} placeholder="https://…framer…" />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Framer toegangssleutel {row.connected && <span className="text-green-600">· ingesteld</span>}</label>
              <input type="password" className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={row.connected ? '•••••• (laat leeg om te behouden)' : 'Plak hier de Framer toegangssleutel'} />
            </div>
            <button onClick={() => { const patch: Record<string, unknown> = { framer_project_url: projectUrl }; if (apiKey.trim()) patch.framer_api_key = apiKey.trim(); saveSettings(patch, 'Framer-toegang opgeslagen.'); setApiKey('') }} disabled={busy === 'save'} className="btn-secondary text-xs"><Save className="h-3.5 w-3.5" />Toegang opslaan</button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button onClick={analyze} disabled={busy === 'analyze' || busy === 'save'} className="btn-primary text-xs">{busy === 'analyze' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}Analyseer Framer project</button>
            <button onClick={testPublish} disabled={busy === 'test_publish'} className="btn-secondary text-xs">{busy === 'test_publish' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}Test publicatie</button>
            <button onClick={getCollections} disabled={busy === 'collections'} className="btn-secondary text-xs">{busy === 'collections' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}Blogcollectie kiezen</button>
            <button onClick={loadLogs} disabled={busy === 'logs'} className="btn-secondary text-xs">{busy === 'logs' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ScrollText className="h-3.5 w-3.5" />}{logs ? 'Logs verbergen' : 'Logs'}</button>
          </div>

          <p className="text-[11px] text-gray-400">Tip: klik op <b>Analyseer Framer project</b> — de app kiest automatisch de blogcollectie en koppelt de velden. Je hoeft geen technische ID&apos;s op te zoeken.</p>

          {collections && (
            <div className="rounded-xl border border-gray-100 p-3 space-y-2">
              <div className="text-xs font-medium text-gray-600">Kies de blogcollectie</div>
              {collections.length === 0 ? <p className="text-xs text-gray-400">Geen collecties gevonden.</p> : collections.map((c) => (
                <label key={c.id} className="flex items-center justify-between gap-2 text-sm">
                  <span>{c.name}</span>
                  <button onClick={() => chooseCollection(c.id)} disabled={busy === 'save' || busy === 'fields'} className="btn-secondary text-xs"><Save className="h-3.5 w-3.5" />Kiezen</button>
                </label>
              ))}
            </div>
          )}

          {fields && (
            <div className="rounded-xl border border-gray-100 p-3 space-y-2">
              <div className="text-xs font-medium text-gray-600">Framer velden (automatisch voorgesteld — aanpasbaar)</div>
              {FIELD_KEYS.map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-24 text-xs text-gray-500 capitalize">{k === 'excerpt' ? 'samenvatting' : k}</span>
                  <select value={map[k] ?? ''} onChange={(e) => setMap((m) => ({ ...m, [k]: e.target.value }))} className="flex-1 rounded-lg border border-gray-200 px-2 py-1 text-xs">
                    <option value="">— geen —</option>
                    {fields.map((f) => <option key={f.id} value={f.id}>{f.name || f.id}</option>)}
                  </select>
                </div>
              ))}
              <button onClick={() => saveSettings({ framer_field_map: Object.fromEntries(Object.entries(map).filter(([, v]) => v)) }, 'Velden gekoppeld.')} disabled={busy === 'save'} className="btn-primary text-xs"><Save className="h-3.5 w-3.5" />Velden opslaan</button>
            </div>
          )}

          {logs && (
            <div className="rounded-xl border border-gray-100 p-3">
              <div className="text-xs font-medium text-gray-600 mb-2">Logboek</div>
              {logs.length === 0 ? <p className="text-xs text-gray-400">Nog geen acties gelogd.</p> : (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {logs.map((l) => (
                    <div key={l.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-gray-500">{formatDate(l.created_at)} · <span className="font-medium text-gray-700">{l.actie}</span></span>
                      <span className={l.status === 'ok' ? 'text-green-600' : 'text-red-600'} title={l.foutmelding ?? undefined}>{l.status === 'ok' ? 'ok' : 'fout'}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
