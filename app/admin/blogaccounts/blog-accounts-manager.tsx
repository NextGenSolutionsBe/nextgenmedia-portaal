'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { Plus, X, Loader2, Pencil, Trash2, Sparkles, Newspaper, CheckCircle2, AlertTriangle, Link2, CalendarDays, BookOpen } from 'lucide-react'
import { toast } from 'sonner'
import { formatDate } from '@/lib/utils'
import { postJson } from '@/lib/api-client'

export type Knowledge = {
  bedrijfsinformatie?: string; doelgroep?: string; tone_of_voice?: string
  belangrijke_termen?: string[]; verboden_woorden?: string[]; cases?: string[]
}

type Account = {
  id: string; name: string; website_url: string | null; client_id: string | null; client_name: string | null
  active: boolean; frequentie_maanden: number; aantal_per_cyclus: number; startdatum: string | null
  volgende_generatie_datum: string | null; max_live_blogs: number | null; briefing: string | null
  framer_project_url: string | null; has_api_key: boolean; framer_valid: boolean
  knowledge: Knowledge | null
  published: number; review: number; failed: number
}
type ClientOpt = { id: string; company_name: string }

export function BlogAccountsManager() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [clients, setClients] = useState<ClientOpt[]>([])
  const [loading, setLoading] = useState(true)
  const [dialog, setDialog] = useState<{ account: Account | null } | null>(null)
  const [genFor, setGenFor] = useState<Account | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try { const res = await fetch('/api/admin/blog-accounts'); const j = await res.json(); if (res.ok) { setAccounts(j.accounts ?? []); setClients(j.clients ?? []) } }
    catch { /* stil */ } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const remove = async (a: Account) => {
    if (!confirm(`Blogproject "${a.name}" verwijderen?`)) return
    setBusy(a.id)
    try {
      let res = await fetch(`/api/admin/blog-accounts?id=${a.id}`, { method: 'DELETE' })
      let j = await res.json()
      // Project heeft blogs → extra bevestiging, dan cascade-verwijderen.
      if (res.status === 409 && j.needsForce) {
        setBusy(null)
        if (!confirm(`Dit project heeft ${j.blogCount} blog(s). Die worden mee VERWIJDERD (definitief, ook van de planning). Doorgaan?`)) return
        setBusy(a.id)
        res = await fetch(`/api/admin/blog-accounts?id=${a.id}&force=1`, { method: 'DELETE' })
        j = await res.json()
      }
      if (!res.ok) throw new Error(j.error)
      toast.success(j.deletedBlogs ? `Project en ${j.deletedBlogs} blog(s) verwijderd.` : 'Project verwijderd.')
      await load()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }
  const connectFramer = async (id: string) => {
    setBusy(id + ':framer')
    try { const j = await postJson('/api/admin/blog-accounts', { action: 'connect_framer', id }); toast.success(`Framer gekoppeld (${String(j.collection)}).`); await load() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><button onClick={() => setDialog({ account: null })} className="btn-primary text-sm"><Plus className="h-4 w-4" />Blogproject</button></div>

      {loading ? (
        <div className="card-base text-center py-10 text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : accounts.length === 0 ? (
        <div className="card-base empty-state"><Newspaper className="h-8 w-8 mx-auto mb-3 opacity-30" /><p className="text-sm">Nog geen blogprojecten. Maak er één aan om blogs te genereren.</p></div>
      ) : (
        <div className="space-y-3">
          {accounts.map((a) => {
            const hasFramerCreds = !!(a.framer_project_url && a.has_api_key)
            return (
              <div key={a.id} className="card-base">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      {a.name}
                      {!a.active && <span className="status-badge bg-gray-100 text-gray-600 text-[10px]">inactief</span>}
                      {a.client_name ? <span className="status-badge bg-sky-100 text-sky-700 text-[10px]">klant: {a.client_name}</span> : <span className="status-badge bg-gray-100 text-gray-600 text-[10px]">geen klant</span>}
                      {a.framer_valid
                        ? <span className="inline-flex items-center gap-1 text-[10px] text-green-700"><CheckCircle2 className="h-3 w-3" />Framer gekoppeld</span>
                        : <span className="inline-flex items-center gap-1 text-[10px] text-amber-600"><AlertTriangle className="h-3 w-3" />Framer niet gekoppeld</span>}
                    </div>
                    <div className="text-xs text-gray-400 mt-1 flex flex-wrap gap-x-3">
                      {a.website_url && <span>{a.website_url.replace(/^https?:\/\//, '')}</span>}
                      <span>{a.aantal_per_cyclus} blog(s) per {a.frequentie_maanden} mnd</span>
                      <span>volgende bloggeneratie: {a.volgende_generatie_datum ? formatDate(a.volgende_generatie_datum) : '—'}</span>
                      {a.max_live_blogs ? <span>max {a.max_live_blogs} live</span> : null}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                      <span className="status-badge bg-green-100 text-green-700">{a.published} gepubliceerd</span>
                      <span className="status-badge bg-amber-100 text-amber-700">{a.review} te beoordelen</span>
                      {a.failed > 0 && <span className="status-badge bg-red-100 text-red-700">{a.failed} mislukt</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {hasFramerCreds && !a.framer_valid && (
                      <button onClick={() => connectFramer(a.id)} disabled={busy === a.id + ':framer'} className="btn-secondary text-xs">{busy === a.id + ':framer' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}Koppel Framer</button>
                    )}
                    <button onClick={() => setGenFor(a)} className="btn-primary text-xs"><Sparkles className="h-3.5 w-3.5" />Blog genereren</button>
                    <Link href={`/admin/blog-calendar?account=${a.id}`} className="btn-secondary text-xs"><CalendarDays className="h-3.5 w-3.5" />Kalender</Link>
                    <button onClick={() => setDialog({ account: a })} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400"><Pencil className="h-3.5 w-3.5" /></button>
                    <button onClick={() => remove(a)} disabled={busy === a.id} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400"><Trash2 className="h-3.5 w-3.5" /></button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {dialog && <ProjectDialog account={dialog.account} clients={clients} onClose={() => setDialog(null)} onSaved={() => { setDialog(null); load() }} />}
      {genFor && <GenerateDialog account={genFor} onClose={() => setGenFor(null)} onDone={() => { setGenFor(null); load() }} />}
    </div>
  )
}

function GenerateDialog({ account, onClose, onDone }: { account: Account; onClose: () => void; onDone: () => void }) {
  const [count, setCount] = useState(account.aantal_per_cyclus || 1)
  const [topic, setTopic] = useState('')
  const [date, setDate] = useState('')
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    const total = Math.max(1, count)
    setLoading(true); setError(null); setProgress('')
    // Eén blog per verzoek → elk verzoek blijft kort (geen time-out bij meerdere).
    let created = 0
    try {
      for (let i = 0; i < total; i++) {
        setProgress(`Blog ${i + 1} van ${total} genereren…`)
        const body: Record<string, unknown> = { action: 'generate', account_id: account.id, count: 1 }
        if (topic.trim()) body.topic = topic.trim()
        if (date) body.publish_at = new Date(date).toISOString()
        const j = await postJson('/api/admin/blogs', body)
        created += Number(j.created) || 0
      }
      toast.success(`${created} blog(s) gegenereerd — staan in de kalender.`); onDone()
    } catch (e) {
      if (created > 0) toast.success(`${created} blog(s) gegenereerd.`)
      setError((e instanceof Error ? e.message : 'Genereren mislukt') + (created > 0 ? ` (${created} gelukt voordat het stopte)` : ''))
    } finally { setLoading(false); setProgress('') }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold">Blog genereren — {account.name}</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><label className="block text-xs text-gray-600 mb-1">Aantal blogs</label><input type="number" min="1" max="10" className={inp} value={count} onChange={(e) => setCount(Number(e.target.value))} /></div>
          <div><label className="block text-xs text-gray-600 mb-1">Onderwerp (optioneel)</label><input className={inp} value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Laat leeg om de AI te laten kiezen" /></div>
          <div><label className="block text-xs text-gray-600 mb-1">Publicatiedatum (optioneel)</label><input type="date" className={inp} value={date} onChange={(e) => setDate(e.target.value)} /><p className="text-[11px] text-gray-400 mt-1">Met een datum wordt de blog na goedkeuring automatisch op die dag gepubliceerd.</p></div>
          {loading && progress && <div className="text-xs text-gray-500 flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />{progress}</div>}
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button onClick={submit} disabled={loading} className="btn-primary flex-1 justify-center">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}Genereren</button>
            <button onClick={onClose} disabled={loading} className="btn-secondary">Annuleer</button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ProjectDialog({ account, clients, onClose, onSaved }: { account: Account | null; clients: ClientOpt[]; onClose: () => void; onSaved: () => void }) {
  const isEdit = !!account
  const [f, setF] = useState({
    name: account?.name ?? '', website_url: account?.website_url ?? '', briefing: account?.briefing ?? '',
    client_id: account?.client_id ?? '', frequentie_maanden: account?.frequentie_maanden ?? 1, aantal_per_cyclus: account?.aantal_per_cyclus ?? 1,
    startdatum: account?.startdatum ?? '', max_live_blogs: account?.max_live_blogs ?? '', active: account?.active ?? true,
    framer_project_url: account?.framer_project_url ?? '',
  })
  const [apiKey, setApiKey] = useState('')
  const k = account?.knowledge ?? null
  const csv = (v?: string[]) => (v ?? []).join(', ')
  const [kn, setKn] = useState({
    bedrijfsinformatie: k?.bedrijfsinformatie ?? '', doelgroep: k?.doelgroep ?? '', tone_of_voice: k?.tone_of_voice ?? '',
    belangrijke_termen: csv(k?.belangrijke_termen), verboden_woorden: csv(k?.verboden_woorden), cases: (k?.cases ?? []).join('\n'),
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!f.name.trim()) { setError('Projectnaam is verplicht'); return }
    setLoading(true); setError(null)
    try {
      const list = (s: string) => s.split(',').map((x) => x.trim()).filter(Boolean)
      const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)
      const knowledge = {
        bedrijfsinformatie: kn.bedrijfsinformatie.trim() || undefined, doelgroep: kn.doelgroep.trim() || undefined, tone_of_voice: kn.tone_of_voice.trim() || undefined,
        belangrijke_termen: list(kn.belangrijke_termen), verboden_woorden: list(kn.verboden_woorden), cases: lines(kn.cases),
      }
      const hasKnowledge = Object.values(knowledge).some((v) => Array.isArray(v) ? v.length : !!v)
      const body: Record<string, unknown> = { ...f, client_id: f.client_id || null, max_live_blogs: f.max_live_blogs || null, startdatum: f.startdatum || null, knowledge: hasKnowledge ? knowledge : null }
      if (apiKey.trim()) body.framer_api_key = apiKey.trim()
      if (isEdit) body.id = account!.id
      const res = await fetch('/api/admin/blog-accounts', { method: isEdit ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      const id = isEdit ? account!.id : j.id
      // Framer automatisch koppelen als project + sleutel aanwezig zijn.
      if (id && f.framer_project_url.trim() && (apiKey.trim() || account?.has_api_key)) {
        try {
          const cr = await fetch('/api/admin/blog-accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'connect_framer', id }) })
          const cj = await cr.json()
          if (cr.ok) toast.success(`Opgeslagen + Framer gekoppeld (${cj.collection}).`)
          else toast.message(`Opgeslagen. Framer koppelen lukte niet: ${cj.error}`)
        } catch { toast.success('Opgeslagen.') }
      } else {
        toast.success(isEdit ? 'Opgeslagen.' : 'Blogproject aangemaakt.')
      }
      onSaved()
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout') } finally { setLoading(false) }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold">{isEdit ? 'Blogproject bewerken' : 'Nieuw blogproject'}</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div><label className="block text-xs text-gray-600 mb-1">Projectnaam</label><input className={inp} value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /></div>
          <div><label className="block text-xs text-gray-600 mb-1">Klant (optioneel)</label>
            <select className={inp} value={f.client_id} onChange={(e) => setF((x) => ({ ...x, client_id: e.target.value }))}><option value="">— Geen klant —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select>
          </div>
          <div><label className="block text-xs text-gray-600 mb-1">Website</label><input className={inp} value={f.website_url} onChange={(e) => setF((x) => ({ ...x, website_url: e.target.value }))} placeholder="https://…" /></div>
          <div><label className="block text-xs text-gray-600 mb-1">Briefing / bedrijfsinformatie</label><textarea rows={4} className={inp} value={f.briefing} onChange={(e) => setF((x) => ({ ...x, briefing: e.target.value }))} placeholder="Wat doet de onderneming, doelgroep, diensten, USP's, onderwerpen…" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs text-gray-600 mb-1">Frequentie (maanden)</label><input type="number" min="1" className={inp} value={f.frequentie_maanden} onChange={(e) => setF((x) => ({ ...x, frequentie_maanden: Number(e.target.value) }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">Blogs per cyclus</label><input type="number" min="1" className={inp} value={f.aantal_per_cyclus} onChange={(e) => setF((x) => ({ ...x, aantal_per_cyclus: Number(e.target.value) }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">Startdatum</label><input type="date" className={inp} value={f.startdatum} onChange={(e) => setF((x) => ({ ...x, startdatum: e.target.value }))} /></div>
            <div><label className="block text-xs text-gray-600 mb-1">Max. live blogs (optioneel)</label><input type="number" min="1" className={inp} value={f.max_live_blogs} onChange={(e) => setF((x) => ({ ...x, max_live_blogs: e.target.value }))} /></div>
          </div>

          <div className="border-t border-gray-100 pt-3 space-y-3">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide">Framer</div>
            <div><label className="block text-xs text-gray-600 mb-1">Framer project</label><input className={inp} value={f.framer_project_url} onChange={(e) => setF((x) => ({ ...x, framer_project_url: e.target.value }))} placeholder="https://…framer…" /></div>
            <div><label className="block text-xs text-gray-600 mb-1">Toegangssleutel {account?.has_api_key && <span className="text-green-600">· ingesteld</span>}</label><input type="password" className={inp} value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={account?.has_api_key ? '•••••• (laat leeg om te behouden)' : 'Plak hier de sleutel'} /></div>
            <p className="text-[11px] text-gray-400">Bij opslaan koppelt de app automatisch de juiste blogcollectie en velden.</p>
          </div>

          <div className="border-t border-gray-100 pt-3 space-y-3">
            <div className="text-xs font-medium text-gray-500 uppercase tracking-wide flex items-center gap-1.5"><BookOpen className="h-3.5 w-3.5" />Kennisbank (optioneel — AI gebruikt dit met voorrang)</div>
            <div><label className="block text-xs text-gray-600 mb-1">Bedrijfsinformatie</label><textarea rows={2} className={inp} value={kn.bedrijfsinformatie} onChange={(e) => setKn((x) => ({ ...x, bedrijfsinformatie: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-gray-600 mb-1">Doelgroep</label><input className={inp} value={kn.doelgroep} onChange={(e) => setKn((x) => ({ ...x, doelgroep: e.target.value }))} /></div>
              <div><label className="block text-xs text-gray-600 mb-1">Tone of voice</label><input className={inp} value={kn.tone_of_voice} onChange={(e) => setKn((x) => ({ ...x, tone_of_voice: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs text-gray-600 mb-1">Belangrijke termen (komma)</label><input className={inp} value={kn.belangrijke_termen} onChange={(e) => setKn((x) => ({ ...x, belangrijke_termen: e.target.value }))} /></div>
              <div><label className="block text-xs text-gray-600 mb-1">Verboden woorden (komma)</label><input className={inp} value={kn.verboden_woorden} onChange={(e) => setKn((x) => ({ ...x, verboden_woorden: e.target.value }))} /></div>
            </div>
            <div><label className="block text-xs text-gray-600 mb-1">Cases / voorbeelden (één per lijn)</label><textarea rows={2} className={inp} value={kn.cases} onChange={(e) => setKn((x) => ({ ...x, cases: e.target.value }))} /></div>
          </div>

          {isEdit && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={(e) => setF((x) => ({ ...x, active: e.target.checked }))} />Actief</label>}
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button onClick={submit} disabled={loading} className="btn-primary flex-1 justify-center">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{isEdit ? 'Opslaan' : 'Aanmaken'}</button>
            <button onClick={onClose} className="btn-secondary">Annuleer</button>
          </div>
        </div>
      </div>
    </div>
  )
}
