'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Loader2, Link2, X, Check, AlertTriangle, RefreshCw } from 'lucide-react'
import { MetricoolCalendarView, colorFor, type MetricoolCalPost } from '@/components/metricool/calendar-view'

type Brand = { blogId: string; name: string; picture?: string | null }
type ClientRow = { id: string; company_name: string; metricool_blog_id: string | null; metricool_brand_name: string | null }

// ── Naam-matching voor auto-koppelen (klant ↔ Metricool-merk) ─────────────────
function normName(s: string) { return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '') }
function tokenize(s: string) { return s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1) }
function matchScore(clientName: string, brandName: string): number {
  const c = normName(clientName), b = normName(brandName)
  if (!c || !b) return 0
  if (c === b) return 1
  if (c.includes(b) || b.includes(c)) return 0.85
  const ct = new Set(tokenize(clientName)), bt = new Set(tokenize(brandName))
  if (ct.size === 0 || bt.size === 0) return 0
  let inter = 0
  for (const t of ct) if (bt.has(t)) inter++
  return inter / Math.max(ct.size, bt.size)
}
function bestBrand(clientName: string, brands: Brand[], used: Set<string>): Brand | null {
  let best: Brand | null = null, score = 0
  for (const b of brands) {
    if (used.has(b.blogId)) continue
    const s = matchScore(clientName, b.name)
    if (s > score) { score = s; best = b }
  }
  return score >= 0.8 ? best : null   // enkel zekere matches automatisch koppelen
}

export function MetricoolClient() {
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [migrated, setMigrated] = useState(true)
  const [clients, setClients] = useState<ClientRow[]>([])
  const [brands, setBrands] = useState<Brand[]>([])
  const [selectedClients, setSelectedClients] = useState<Set<string>>(new Set()) // leeg = alle gekoppelde
  const [posts, setPosts] = useState<MetricoolCalPost[]>([])
  const [loadingPosts, setLoadingPosts] = useState(false)
  const [postErrors, setPostErrors] = useState<Array<{ clientName: string; error: string }>>([])
  const [linkOpen, setLinkOpen] = useState(false)

  const range = useRef<{ start: string; end: string } | null>(null)
  const linkedClients = clients.filter((c) => c.metricool_blog_id)

  const loadBrands = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/metricool/brands')
      const j = await res.json()
      setConfigured(!!j.configured)
      setMigrated(j.migrated !== false)
      setClients(j.clients ?? [])
      setBrands(j.brands ?? [])
    } catch { setConfigured(false) }
  }, [])

  useEffect(() => { loadBrands() }, [loadBrands])

  const fetchPosts = useCallback(async () => {
    if (!range.current) return
    setLoadingPosts(true)
    try {
      const ids = Array.from(selectedClients)
      const qs = new URLSearchParams({ start: range.current.start, end: range.current.end })
      if (ids.length > 0) qs.set('clientIds', ids.join(','))
      const res = await fetch(`/api/admin/metricool/posts?${qs.toString()}`)
      const j = await res.json()
      setPosts(j.posts ?? [])
      setPostErrors(j.errors ?? [])
    } catch { setPosts([]) } finally { setLoadingPosts(false) }
  }, [selectedClients])

  // Herlaad wanneer de klantfilter wijzigt (met het huidige maandbereik).
  useEffect(() => { if (configured) fetchPosts() }, [fetchPosts, configured])

  const onRangeChange = (start: string, end: string) => {
    range.current = { start, end }
    if (configured) fetchPosts()
  }

  const toggleClient = (id: string) => setSelectedClients((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  if (configured === null) {
    return <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mr-2" />Laden…</div>
  }

  if (!configured) {
    return (
      <div className="card-base border-amber-200 bg-amber-50/40">
        <div className="flex items-start gap-3">
          <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm text-amber-800">
            <p className="font-medium">Metricool is nog niet geconfigureerd.</p>
            <p className="mt-1 text-amber-700">Zet <code className="font-mono">METRICOOL_USER_TOKEN</code> en <code className="font-mono">METRICOOL_USER_ID</code> in de omgeving (Vercel) en herlaad deze pagina.</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setSelectedClients(new Set())} className={`text-xs px-3 py-1.5 rounded-lg border ${selectedClients.size === 0 ? 'bg-black text-white border-black' : 'border-gray-200 hover:bg-gray-50'}`}>
            Alle klanten ({linkedClients.length})
          </button>
          {linkedClients.map((c) => {
            const on = selectedClients.has(c.id)
            return (
              <button key={c.id} onClick={() => toggleClient(c.id)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border flex items-center gap-1.5 ${on ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50'}`}>
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colorFor(c.id) }} />
                {c.company_name}
              </button>
            )
          })}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchPosts} disabled={loadingPosts} className="btn-secondary text-sm">
            {loadingPosts ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Verversen
          </button>
          <button onClick={() => setLinkOpen(true)} className="btn-secondary text-sm"><Link2 className="h-4 w-4" />Klanten koppelen</button>
        </div>
      </div>

      {linkedClients.length === 0 && (
        <div className="card-base text-sm text-gray-500">
          Nog geen klanten gekoppeld aan een Metricool-merk. Klik op <b>Klanten koppelen</b> om te starten.
        </div>
      )}

      <MetricoolCalendarView posts={posts} loading={loadingPosts} onRangeChange={onRangeChange} showClientName />

      {postErrors.length > 0 && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Kon posts voor {postErrors.length} klant(en) niet ophalen: {postErrors.map((e) => e.clientName).join(', ')}.
        </div>
      )}

      {linkOpen && (
        <LinkDialog clients={clients} brands={brands} migrated={migrated} onClose={() => setLinkOpen(false)} onChanged={loadBrands} />
      )}
    </div>
  )
}

function LinkDialog({
  clients, brands, migrated, onClose, onChanged,
}: {
  clients: ClientRow[]; brands: Brand[]; migrated: boolean; onClose: () => void; onChanged: () => void
}) {
  const [saving, setSaving] = useState<string | null>(null)
  const [autoRunning, setAutoRunning] = useState(false)
  const [autoDone, setAutoDone] = useState<number | null>(null)
  const setLink = async (client: ClientRow, blogId: string) => {
    setSaving(client.id)
    try {
      const brand = brands.find((b) => b.blogId === blogId)
      await fetch('/api/admin/metricool/link', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId: client.id, blogId: blogId || null, brandName: brand?.name ?? null }),
      })
      onChanged()
    } finally { setSaving(null) }
  }

  // Koppelt automatisch enkel zekere naam-matches (nog niet-gekoppelde klanten).
  const autoMatch = async () => {
    setAutoRunning(true); setAutoDone(null)
    try {
      const used = new Set(clients.map((c) => c.metricool_blog_id).filter((v): v is string => !!v))
      let count = 0
      for (const c of clients) {
        if (c.metricool_blog_id) continue
        const b = bestBrand(c.company_name, brands, used)
        if (!b) continue
        used.add(b.blogId)
        await fetch('/api/admin/metricool/link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId: c.id, blogId: b.blogId, brandName: b.name }),
        })
        count++
      }
      setAutoDone(count)
      onChanged()
    } finally { setAutoRunning(false) }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[85dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><Link2 className="h-5 w-5" />Klanten koppelen aan Metricool</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 overflow-y-auto space-y-2">
          {!migrated && (
            <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              De databasekolommen ontbreken nog. Draai de migratie <code className="font-mono">99999999_SYNC_ALL.sql</code> in Supabase; daarna kun je koppelingen opslaan.
            </div>
          )}
          {brands.length === 0 && <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Geen Metricool-merken gevonden. Controleer de API-sleutel.</div>}
          {clients.length === 0 && <div className="text-sm text-gray-500 px-1 py-2">Geen klanten gevonden.</div>}

          {migrated && brands.length > 0 && clients.some((c) => !c.metricool_blog_id) && (
            <div className="flex items-center justify-between gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <span className="text-xs text-gray-600">Koppel automatisch op basis van gelijkende namen (enkel zekere matches).</span>
              <button onClick={autoMatch} disabled={autoRunning} className="btn-secondary text-xs shrink-0">
                {autoRunning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Auto-koppelen
              </button>
            </div>
          )}
          {autoDone !== null && (
            <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
              {autoDone > 0 ? `${autoDone} klant(en) automatisch gekoppeld. Controleer hieronder en pas aan waar nodig.` : 'Geen zekere matches gevonden — koppel handmatig via de dropdowns.'}
            </div>
          )}

          {clients.map((c) => (
            <div key={c.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0 text-sm font-medium truncate">{c.company_name}</div>
              <select
                value={c.metricool_blog_id ?? ''}
                disabled={saving === c.id || !migrated}
                onChange={(e) => setLink(c, e.target.value)}
                className="w-52 px-2 py-1.5 text-xs border border-gray-200 rounded-lg"
              >
                <option value="">— niet gekoppeld —</option>
                {brands.map((b) => <option key={b.blogId} value={b.blogId}>{b.name}</option>)}
              </select>
              {c.metricool_blog_id && <Check className="h-4 w-4 text-green-600 shrink-0" />}
              {saving === c.id && <Loader2 className="h-4 w-4 animate-spin text-gray-400 shrink-0" />}
            </div>
          ))}
        </div>
        <div className="p-4 border-t border-gray-100 flex justify-end">
          <button onClick={onClose} className="btn-primary text-sm">Klaar</button>
        </div>
      </div>
    </div>
  )
}
