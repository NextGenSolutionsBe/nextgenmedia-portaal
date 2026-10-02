'use client'

import { useCallback, useEffect, useState } from 'react'
import { Globe, Loader2, Save, Check, KeyRound, Database, RefreshCw, ExternalLink, Wrench, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'

type Field = { id: string; name: string; type: string; editable?: boolean }
type Collection = {
  id: string; framer_collection_id: string; name: string; slug: string | null
  fields: Field[]; client_editable: boolean; item_count: number; synced_at: string | null
}
type MaintStatus = { active: boolean; endDate: string | null; daysLeft: number | null; expired: boolean; expiringSoon: boolean; label: string }
type Status = {
  platform: string; adminUrl: string
  projectUrl: string; hasApiKey: boolean; cmsEnabled: boolean; configured: boolean
  maintenance: { included: boolean; startDate: string; months: number; status: MaintStatus }
  collections: Collection[]
}

export function ClientCms({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<Status | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [fetching, setFetching] = useState(false)

  // Formulierstaat
  const [platform, setPlatform] = useState('')
  const [adminUrl, setAdminUrl] = useState('')
  const [projectUrl, setProjectUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [cmsIncluded, setCmsIncluded] = useState(false)
  const [maintIncluded, setMaintIncluded] = useState(false)
  const [maintStart, setMaintStart] = useState('')
  const [maintMonths, setMaintMonths] = useState(12)

  const base = `/api/admin/clients/${clientId}/framer`

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(base)
      const j = await res.json()
      if (res.ok) {
        setStatus(j)
        setPlatform(j.platform ?? '')
        setAdminUrl(j.adminUrl ?? '')
        setProjectUrl(j.projectUrl ?? '')
        setCmsIncluded(!!j.cmsEnabled)
        setMaintIncluded(!!j.maintenance?.included)
        setMaintStart(j.maintenance?.startDate ?? '')
        setMaintMonths(j.maintenance?.months ?? 12)
      }
    } catch { /* stil */ } finally { setLoading(false) }
  }, [base])
  useEffect(() => { load() }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        platform, adminUrl,
        maintenance: { included: maintIncluded, startDate: maintStart, months: maintMonths },
      }
      if (platform === 'framer') {
        body.projectUrl = projectUrl
        body.cmsEnabled = cmsIncluded
        if (apiKey.trim()) body.apiKey = apiKey
      }
      const res = await fetch(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setApiKey('')
      await load()
      if (j.importError) toast.warning(`Opgeslagen, maar de CMS ophalen gaf: ${j.importError}`, { duration: 8000 })
      else if (j.imported) toast.success(`Opgeslagen. ${j.imported.collections} collectie(s), ${j.imported.items} item(s) opgehaald.`)
      else toast.success('Opgeslagen.')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setSaving(false) }
  }

  const fetchCms = async () => {
    setFetching(true)
    try {
      const res = await fetch(`${base}/analyze`, { method: 'POST' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success(`${j.summary.collections} collectie(s), ${j.summary.items} item(s) opgehaald.`)
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Ophalen mislukt') } finally { setFetching(false) }
  }

  const toggleCollectionEditable = async (col: Collection) => {
    try {
      const res = await fetch(`${base}/collection`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ framerCollectionId: col.framer_collection_id, clientEditable: !col.client_editable }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') }
  }

  if (loading) return <div className="card-base"><div className="py-4 text-center text-gray-400"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div></div>

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50'
  const ms = status?.maintenance?.status

  return (
    <div className="card-base space-y-4">
      <h2 className="font-semibold text-sm text-gray-900 flex items-center gap-2"><Globe className="h-4 w-4 text-gray-400" />Website</h2>

      {/* Hoe is de site gebouwd? Interne administratie — de klant ziet dit nooit. */}
      <div className="space-y-1.5">
        <label className="block text-[11px] text-gray-500">Type website</label>
        <div className="flex gap-1.5 flex-wrap">
          {[{ v: '', l: 'Geen website' }, { v: 'framer', l: 'Framer' }, { v: 'custom', l: 'Custom code' }].map((o) => (
            <button key={o.v} type="button" onClick={() => setPlatform(o.v)}
              className={`text-xs px-3 py-1.5 rounded-lg border transition-colors ${platform === o.v ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
              {o.l}
            </button>
          ))}
        </div>
      </div>

      {/* Framer: koppeling + CMS */}
      {platform === 'framer' && (
        <div className="space-y-2 rounded-lg border border-gray-100 p-3">
          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={cmsIncluded} onChange={(e) => setCmsIncluded(e.target.checked)} className="h-4 w-4 rounded border-gray-300 accent-[#fff848]" />
            CMS inbegrepen — klant beheert de inhoud in dit portaal
          </label>
          {cmsIncluded && (
            <>
              <label className="block text-[11px] text-gray-500 mt-2">Projectlink of project-ID</label>
              <input className={inp} value={projectUrl} onChange={(e) => setProjectUrl(e.target.value)} placeholder="https://framer.com/projects/…" />
              <label className="block text-[11px] text-gray-500 flex items-center gap-1 mt-2">
                <KeyRound className="h-3 w-3" />API-sleutel
                {status?.hasApiKey && <span className="text-green-600">(ingesteld — leeg laten = behouden)</span>}
              </label>
              <input className={inp} type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                placeholder={status?.hasApiKey ? '•••••••• (behouden)' : 'Site Settings → General → API key'} autoComplete="off" />
              <p className="text-[11px] text-gray-400">De sleutel blijft op de server en wordt nooit naar de browser gestuurd.</p>
            </>
          )}
        </div>
      )}

      {/* Custom code: link naar het beheerplatform */}
      {platform === 'custom' && (
        <div className="space-y-1.5 rounded-lg border border-gray-100 p-3">
          <label className="block text-[11px] text-gray-500">Link naar het beheerplatform</label>
          <input className={inp} type="url" value={adminUrl} onChange={(e) => setAdminUrl(e.target.value)} placeholder="https://beheer.klant.be" />
          <p className="text-[11px] text-gray-400">De klant ziet hier een knop naar dit adres, zodat hij de link nooit hoeft te onthouden.</p>
        </div>
      )}

      {/* Onderhoud */}
      <div className="space-y-2 rounded-lg border border-gray-100 p-3">
        <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
          <input type="checkbox" checked={maintIncluded} onChange={(e) => setMaintIncluded(e.target.checked)} className="h-4 w-4 rounded border-gray-300 accent-[#fff848]" />
          <span className="flex items-center gap-1.5"><Wrench className="h-3.5 w-3.5 text-gray-400" />Onderhoud inbegrepen</span>
        </label>
        {maintIncluded && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Startdatum</label>
              <input className={inp} type="date" value={maintStart} onChange={(e) => setMaintStart(e.target.value)} />
            </div>
            <div>
              <label className="block text-[11px] text-gray-500 mb-1">Looptijd (maanden)</label>
              <input className={inp} type="number" min={1} value={maintMonths} onChange={(e) => setMaintMonths(Number(e.target.value) || 12)} />
            </div>
          </div>
        )}
        {ms?.active && ms.endDate && (
          <div className={`text-xs flex items-center gap-1.5 ${ms.expired ? 'text-red-600' : ms.expiringSoon ? 'text-amber-600' : 'text-gray-600'}`}>
            {(ms.expired || ms.expiringSoon) && <AlertTriangle className="h-3.5 w-3.5" />}
            {ms.label}
          </div>
        )}
        {maintIncluded && <p className="text-[11px] text-gray-400">We krijgen automatisch een interne mail zodra het pakket bijna afloopt.</p>}
      </div>

      <div className="flex gap-2 flex-wrap">
        <button onClick={save} disabled={saving} className="btn-primary text-sm">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Opslaan
        </button>
        {platform === 'framer' && status?.configured && (
          <>
            <button onClick={fetchCms} disabled={fetching} className="btn-secondary text-sm" title="Collecties, velden en items opnieuw ophalen">
              {fetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}CMS ophalen
            </button>
            <a href={`${base}/diag`} target="_blank" rel="noreferrer" className="btn-secondary text-sm" title="Technische diagnose">Diagnose</a>
          </>
        )}
        {platform === 'custom' && adminUrl && (
          <a href={adminUrl} target="_blank" rel="noreferrer" className="btn-secondary text-sm"><ExternalLink className="h-4 w-4" />Beheerplatform openen</a>
        )}
      </div>

      {/* Opgehaalde collecties */}
      {platform === 'framer' && status && status.collections.length > 0 && (
        <div className="space-y-2 pt-1">
          <div className="text-[11px] text-gray-500 flex items-center gap-1"><Database className="h-3 w-3" />Collecties in het CMS</div>
          {status.collections.map((c) => (
            <div key={c.id} className="rounded-lg border border-gray-100 p-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="font-medium text-sm">{c.name || '(naamloos)'}</div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-gray-500">{c.item_count} item(s) · {c.fields.length} veld(en)</span>
                  <button onClick={() => toggleCollectionEditable(c)} className={`text-[11px] px-2 py-0.5 rounded-full border ${c.client_editable ? 'border-green-300 bg-green-50 text-green-700' : 'border-gray-200 text-gray-600'}`}>
                    {c.client_editable ? <span className="flex items-center gap-1"><Check className="h-3 w-3" />klant bewerkt</span> : 'alleen-lezen'}
                  </button>
                </div>
              </div>
              {c.fields.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {c.fields.slice(0, 12).map((f) => (
                    <span key={f.id} className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">{f.name} <span className="text-gray-500">· {f.type}</span></span>
                  ))}
                  {c.fields.length > 12 && <span className="text-[10px] text-gray-500 px-1">+{c.fields.length - 12}</span>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
