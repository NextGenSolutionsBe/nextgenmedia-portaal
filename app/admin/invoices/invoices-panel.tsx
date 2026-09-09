'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Plus, X, Loader2, Trash2, Send, Repeat, FileText, Ban, User, CalendarDays, CheckCircle2, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { formatEuro, SERVICE_LABELS } from '@/lib/utils'
import {
  INVOICE_STATUSES, INVOICE_STATUS_LABEL, DEFAULT_VAT, INVOICE_DAYS, INVOICE_DAY_LABEL,
  inclFromExcl, lastDayOfMonth, monthLabel, thisMonthYM, shiftYM, type ExpandedRevenue,
} from '@/lib/invoices'

type Row = {
  rowId: string; kind: 'eenmalig' | 'recurring'; sourceId: string; month: string
  client_id: string | null; service_slug: string | null; description: string | null
  amount_excl: number; vat_pct: number; amount_incl: number; status: string; revenue_id: string | null
  billing_date: string; clickup_task_id: string | null
  recurring_start: string | null; recurring_end: string | null; invoice_day: string | null
  contract_id?: string | null; contract_title?: string | null
  /** 'client' = onze omzet; setter_* = een afrekening die WIJ ontvangen. */
  invoiceKind?: string
  setterName?: string | null
}

const SETTER_KIND: Record<string, string> = {
  setter_hours: 'Uren appointment setter',
  setter_commission: 'Commissie appointment setter',
}
type ClientOpt = { id: string; company_name: string }
type Summary = {
  omzetExcl: number; linkedExcl: number; verschil: number; pct: number
  /** Nog te versturen en al verstuurd, beide excl. btw. */
  openExcl?: number; doneExcl?: number
}

const SERVICE_OPTS = ['', 'social-media', 'webdesign', 'foto-video', 'grafisch-ontwerp', 'marketing-consultancy', 'ads']
const svcLabel = (s: string | null) => (s ? (SERVICE_LABELS[s] ?? s) : '—')
const todayStr = () => new Date().toISOString().slice(0, 10)

// Vertrouwensscore koppeling: klant > dienst > bedrag (maand is impliciet, want
// de prognoselijst is al maand-gefilterd).
function matchScore(r: Pick<Row, 'client_id' | 'service_slug' | 'amount_excl'>, o: ExpandedRevenue): number {
  if (o.client_id !== r.client_id) return 0
  let s = 50
  if ((o.service_slug ?? null) === (r.service_slug ?? null)) s += 25
  if (Math.abs(o.amount_excl - r.amount_excl) < 0.01) s += 25
  else if (r.amount_excl > 0 && Math.abs(o.amount_excl - r.amount_excl) / r.amount_excl <= 0.1) s += 12
  return s
}
function scoreDot(pct: number) { return pct >= 90 ? 'bg-green-500' : pct >= 60 ? 'bg-amber-500' : 'bg-red-500' }

const MONTHS_NL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
function monthsBetween(fromYM: string, toYM: string): number {
  const [fy, fm] = fromYM.split('-').map(Number); const [ty, tm] = toYM.split('-').map(Number)
  return (ty - fy) * 12 + (tm - fm)
}

export function InvoicesPanel() {
  const [month, setMonth] = useState(thisMonthYM)
  const [rows, setRows] = useState<Row[]>([])
  const [omzet, setOmzet] = useState<ExpandedRevenue[]>([])
  const [clients, setClients] = useState<ClientOpt[]>([])
  const [summary, setSummary] = useState<Summary>({ omzetExcl: 0, linkedExcl: 0, verschil: 0, pct: 0 })
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [clickupEnabled, setClickupEnabled] = useState(false)
  const [fClient, setFClient] = useState(''); const [fService, setFService] = useState(''); const [fStatus, setFStatus] = useState(''); const [fType, setFType] = useState(''); const [fContract, setFContract] = useState('')

  // Performance: enkel de geopende maand laden; bij maandwissel opnieuw.
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/invoices?month=${month}`)
      const j = await res.json()
      if (res.ok) { setRows(j.rows ?? []); setOmzet(j.omzet ?? []); setClients(j.clients ?? []); setSummary(j.summary); setClickupEnabled(!!j.clickup_enabled) }
    } catch { /* stil */ } finally { setLoading(false) }
  }, [month])
  useEffect(() => { load() }, [load])

  const clientName = useMemo(() => new Map(clients.map((c) => [c.id, c.company_name])), [clients])
  const linkedRevenueIds = useMemo(() => new Set(rows.filter((r) => r.revenue_id).map((r) => r.revenue_id)), [rows])
  const omzetById = useMemo(() => new Map(omzet.map((o) => [o.revenue_id, o])), [omzet])

  const filtered = rows.filter((r) =>
    (!fClient || r.client_id === fClient) &&
    (!fService || r.service_slug === fService) &&
    (!fStatus || r.status === fStatus) &&
    (!fType || r.kind === fType) &&
    (!fContract || (fContract === 'with' ? !!r.contract_id : !r.contract_id))
  )

  // Maandtotalen over ALLE rijen (niet de filter) — voor de bovenste kaarten + balk.
  const live = rows.filter((r) => r.status !== 'geannuleerd')
  const teVersturen = live.filter((r) => r.status === 'te_versturen').length
  const verstuurd = live.filter((r) => r.status === 'verstuurd').length
  const totaalLive = live.length
  const sentPct = totaalLive > 0 ? Math.round((verstuurd / totaalLive) * 100) : 0
  const monthDone = totaalLive > 0 && verstuurd === totaalLive && summary.pct >= 100
  const sentColor = sentPct >= 100 ? 'bg-green-500' : sentPct > 0 ? 'bg-amber-500' : 'bg-red-500'

  const suggestionFor = (r: Row): ExpandedRevenue | null => {
    if (r.revenue_id) return null
    const cands = omzet.filter((o) => !linkedRevenueIds.has(o.revenue_id) && o.client_id === r.client_id)
    let best: ExpandedRevenue | null = null, bestScore = 0
    for (const o of cands) { const sc = matchScore(r, o); if (sc > bestScore) { best = o; bestScore = sc } }
    return bestScore >= 50 ? best : null
  }

  const warnings = (r: Row): { icon: string; text: string; tone: string }[] => {
    if (r.status === 'geannuleerd') return [{ icon: '⚪', text: 'Geannuleerd', tone: 'text-gray-400' }]
    const w: { icon: string; text: string; tone: string }[] = []
    // Prognoses zijn uit het platform verdwenen; daar wordt hier dus ook niet
    // meer op gewezen.
    if (r.status === 'te_versturen' && r.billing_date && r.billing_date < todayStr()) w.push({ icon: '🔴', text: 'Factuurdatum voorbij — nog niet verstuurd', tone: 'text-red-600' })
    if (clickupEnabled && !r.clickup_task_id && r.status !== 'geannuleerd') w.push({ icon: '🟠', text: 'Geen ClickUp-taak', tone: 'text-amber-600' })
    if (w.length === 0) w.push({ icon: '🟢', text: 'In orde', tone: 'text-green-600' })
    return w
  }

  const setStatus = async (r: Row, status: string) => {
    setBusy(r.rowId)
    try { const res = await fetch('/api/admin/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'status', kind: r.kind, source_id: r.sourceId, month: r.month, status }) }); const j = await res.json(); if (!res.ok) throw new Error(j.error); if (j.warning) toast.warning(j.warning); await load() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }
  const link = async (r: Row, revenue_id: string) => {
    setBusy(r.rowId)
    try { const res = await fetch('/api/admin/invoices', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: r.kind, id: r.sourceId, revenue_id }) }); const j = await res.json(); if (!res.ok) throw new Error(j.error); await load() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Fout') } finally { setBusy(null) }
  }
  const remove = async (r: Row) => {
    if (!confirm(r.kind === 'recurring' ? 'Recurring factuur (alle maanden) verwijderen?' : 'Factuur verwijderen?')) return
    setBusy(r.rowId)
    try { await fetch(`/api/admin/invoices?kind=${r.kind}&id=${r.sourceId}`, { method: 'DELETE' }); await load() } finally { setBusy(null) }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <button onClick={() => setMonth((m) => shiftYM(m, -1))} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[150px] text-center text-sm font-semibold capitalize">{monthLabel(month)}</span>
          <button onClick={() => setMonth((m) => shiftYM(m, 1))} className="rounded-lg border border-gray-200 p-2 hover:bg-gray-50"><ChevronRight className="h-4 w-4" /></button>
          {month !== thisMonthYM() && <button onClick={() => setMonth(thisMonthYM())} className="text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">Deze maand</button>}
        </div>
        <div className="flex items-center gap-2">
          <Link href="/admin/invoices/planner" className="btn-secondary text-sm"><CalendarDays className="h-4 w-4" />Planner</Link>
          <button onClick={() => setCreating(true)} className="btn-primary text-sm"><Plus className="h-4 w-4" />Nieuwe factuur</button>
        </div>
      </div>

      {/* ClickUp sync-status */}
      <div className="inline-flex items-center gap-1.5 text-xs rounded-lg border px-2.5 py-1.5 w-fit" style={{ borderColor: clickupEnabled ? '#bbf7d0' : '#e5e7eb', background: clickupEnabled ? '#f0fdf4' : '#f9fafb' }}>
        <span className={`h-2 w-2 rounded-full ${clickupEnabled ? 'bg-green-500' : 'bg-gray-300'}`} />
        ClickUp sync: <b className={clickupEnabled ? 'text-green-700' : 'text-gray-500'}>{clickupEnabled ? 'Actief' : 'Niet geconfigureerd'}</b>
      </div>

      {/* 4 kaarten */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Te versturen" value={teVersturen} />
        <Kpi label="Verstuurd" value={verstuurd} />
        <Kpi label="Openstaand bedrag" value={formatEuro(summary.openExcl ?? 0)} sub="excl. btw" />
        <Kpi label="Facturatie voltooid" value={`${summary.pct}%`} />
      </div>

      {/* Maandafsluiting */}
      {monthDone && (
        <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          <CheckCircle2 className="h-5 w-5" />Maand volledig afgewerkt 🟢
        </div>
      )}

      {/* Grote voortgangsbalk */}
      <div className="card-base">
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="font-semibold capitalize">{MONTHS_NL[Number(month.slice(5, 7)) - 1]}</span>
          <span className="text-gray-500">{verstuurd} van {totaalLive} facturen verstuurd · <b className="text-gray-800">{sentPct}%</b></span>
        </div>
        <div className="h-4 w-full rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${sentColor} transition-all`} style={{ width: `${sentPct}%` }} /></div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <select value={fClient} onChange={(e) => setFClient(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"><option value="">Alle klanten</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select>
        <select value={fService} onChange={(e) => setFService(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"><option value="">Alle diensten</option>{SERVICE_OPTS.filter(Boolean).map((s) => <option key={s} value={s}>{svcLabel(s)}</option>)}</select>
        <select value={fType} onChange={(e) => setFType(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"><option value="">Alle types</option><option value="eenmalig">Eenmalig</option><option value="recurring">Recurring</option></select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"><option value="">Alle statussen</option>{INVOICE_STATUSES.map((s) => <option key={s} value={s}>{INVOICE_STATUS_LABEL[s]}</option>)}</select>
        <select value={fContract} onChange={(e) => setFContract(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs"><option value="">Alle (contract)</option><option value="with">Met contract</option><option value="without">Zonder contract</option></select>
        <span className="text-xs text-gray-400">{filtered.length} factuur/facturen</span>
      </div>

      {/* Werklijst */}
      {loading ? (
        <div className="card-base py-10 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="card-base"><p className="empty-state text-sm">Geen facturen voor deze selectie.</p></div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const ws = warnings(r)
            const cancelled = r.status === 'geannuleerd'
            const remaining = r.recurring_end ? Math.max(0, monthsBetween(month, r.recurring_end) + 1) : null
            return (
              <div key={r.rowId} className={`card-base ${cancelled ? 'opacity-60' : ''}`}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0">
                    <div className="font-medium flex items-center gap-2 flex-wrap">
                      {r.setterName
                        ? r.setterName
                        : r.client_id ? (clientName.get(r.client_id) ?? '—') : '—'}
                      <span className={`status-badge text-[10px] inline-flex items-center gap-1 ${r.kind === 'recurring' ? 'bg-purple-100 text-purple-700' : 'bg-gray-100 text-gray-600'}`}>
                        {r.kind === 'recurring' ? <><Repeat className="h-3 w-3" />Recurring</> : <><FileText className="h-3 w-3" />Eenmalig</>}
                      </span>
                      {/* Een afrekening die WIJ ontvangen — geen omzet. Dat moet
                          in één oogopslag duidelijk zijn tussen de klantfacturen. */}
                      {r.invoiceKind && r.invoiceKind !== 'client' && (
                        <span className="status-badge text-[10px] bg-orange-100 text-orange-800">
                          Te betalen · {SETTER_KIND[r.invoiceKind] ?? 'appointment setter'}
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-x-2">
                      <span>{svcLabel(r.service_slug)}</span>
                      <span>· {formatEuro(r.amount_excl)} excl · {formatEuro(r.amount_incl)} incl</span>
                      {r.description && <span>· {r.description}</span>}
                      {r.contract_title && <span className="text-gray-500">· 📄 {r.contract_title}</span>}
                    </div>
                    {/* Recurring-visualisatie */}
                    {r.kind === 'recurring' && r.recurring_start && (
                      <div className="text-[11px] text-purple-700 mt-1">
                        Loopt: {monthLabel(r.recurring_start)} → {r.recurring_end ? monthLabel(r.recurring_end) : 'doorlopend'}
                        {remaining != null && <> · nog {remaining} maand(en) actief</>}
                        <> · volgende factuur: {new Date(r.billing_date + 'T00:00:00').toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })}</>
                      </div>
                    )}
                    {/* Waarschuwingen */}
                    <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
                      {ws.map((w, i) => <span key={i} className={`text-[11px] ${w.tone}`}>{w.icon} {w.text}</span>)}
                    </div>
                  </div>

                  {/* Snelle acties (geen aparte schermen) */}
                  <div className="flex items-center gap-1 shrink-0">
                    {r.status === 'te_versturen' && <button onClick={() => setStatus(r, 'verstuurd')} disabled={busy === r.rowId} className="btn-primary text-xs" title="Markeer als verstuurd">{busy === r.rowId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Verstuurd</button>}
                    {r.status === 'verstuurd' && <button onClick={() => setStatus(r, 'te_versturen')} disabled={busy === r.rowId} className="btn-secondary text-xs" title="Terug naar te versturen">Te versturen</button>}
                    {!cancelled && <button onClick={() => setStatus(r, 'geannuleerd')} disabled={busy === r.rowId} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400" title="Annuleren"><Ban className="h-3.5 w-3.5" /></button>}
                    {r.client_id && <Link href={`/admin/clients/${r.client_id}`} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400" title="Open klant"><User className="h-3.5 w-3.5" /></Link>}
                    <button onClick={() => remove(r)} disabled={busy === r.rowId} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400" title="Verwijderen">{busy === r.rowId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}</button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {creating && <CreateDialog month={month} clients={clients} onClose={() => setCreating(false)} onSaved={(warning) => { setCreating(false); if (warning) toast.warning(warning); load() }} />}
    </div>
  )
}

function Kpi({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return <div className="rounded-xl border border-gray-100 p-3"><div className="text-[11px] text-gray-500">{label}</div><div className="mt-0.5 text-lg font-bold">{value}</div>{sub && <div className="text-[10px] text-gray-400">{sub}</div>}</div>
}

const PAY_MOMENTS: { v: string; l: string }[] = [
  { v: 'last', l: 'Laatste dag van de maand' },
  { v: 'first', l: 'Dag 1' },
  { v: 'mid', l: 'Dag 15' },
  { v: 'specific', l: 'Specifieke datum' },
]

function CreateDialog({ month, clients, onClose, onSaved }: { month: string; clients: ClientOpt[]; onClose: () => void; onSaved: (warning?: string | null) => void }) {
  const [type, setType] = useState<'eenmalig' | 'recurring'>('eenmalig')
  const [form, setForm] = useState({ client_id: '', service_slug: '', description: '', amount_excl: '', vat_pct: String(DEFAULT_VAT), status: 'te_versturen', revenue_id: '', start_month: month, end_month: '', active: true, invoice_day: 'last', invoice_month: month, pay_moment: 'last', invoice_date_specific: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [matches, setMatches] = useState<ExpandedRevenue[]>([])
  const [matchLoading, setMatchLoading] = useState(false)
  const excl = parseFloat(form.amount_excl) || 0
  const vat = parseFloat(form.vat_pct) || 0
  const incl = inclFromExcl(excl, vat)

  // De maand waarvoor we prognoses zoeken: eenmalig → factuurmaand, recurring → startmaand.
  const effMonth = type === 'recurring' ? form.start_month : form.invoice_month

  // Relevante prognoses ophalen: ENKEL van deze klant in deze maand (server-side, niet globaal).
  useEffect(() => {
    if (!form.client_id || !/^\d{4}-\d{2}$/.test(effMonth)) { setMatches([]); return }
    let cancel = false
    setMatchLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/revenue/match?client_id=${form.client_id}&month=${effMonth}`)
        const j = await res.json()
        if (!cancel) setMatches(res.ok ? (j.candidates ?? []) : [])
      } catch { if (!cancel) setMatches([]) } finally { if (!cancel) setMatchLoading(false) }
    }, 250)
    return () => { cancel = true; clearTimeout(t) }
  }, [form.client_id, effMonth])

  // Bedrag-exacte matches krijgen voorrang; anders alle prognoses van klant+maand.
  const exact = matches.filter((m) => excl > 0 && Math.abs(m.amount_excl - excl) < 0.01)
  const pool = exact.length ? exact : matches
  const poolKey = pool.map((p) => p.revenue_id).join('|')

  // 1 match → automatisch koppelen; meerdere → keuze; geen → leeg (backend maakt aan).
  useEffect(() => {
    if (pool.length === 1) setForm((f) => (f.revenue_id === pool[0].revenue_id ? f : { ...f, revenue_id: pool[0].revenue_id }))
    else setForm((f) => (f.revenue_id && pool.some((p) => p.revenue_id === f.revenue_id) ? f : { ...f, revenue_id: '' }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolKey])

  const oneTimeInvoiceDate = () => {
    const m = form.invoice_month
    if (form.pay_moment === 'specific') return form.invoice_date_specific || lastDayOfMonth(m)
    if (form.pay_moment === 'first') return `${m}-01`
    if (form.pay_moment === 'mid') return `${m}-15`
    return lastDayOfMonth(m)
  }

  const submit = async () => {
    if (!form.client_id) { setError('Selecteer een klant voor deze factuur.'); return }
    if (excl <= 0) { setError('Bedrag excl. btw is verplicht'); return }
    setLoading(true); setError(null)
    try {
      const body = type === 'recurring'
        ? { action: 'recurring', client_id: form.client_id, service_slug: form.service_slug, description: form.description, amount_excl: excl, vat_pct: vat, start_month: form.start_month, end_month: form.end_month || null, active: form.active, revenue_id: form.revenue_id, invoice_day: form.invoice_day }
        : { action: 'one_time', client_id: form.client_id, service_slug: form.service_slug, description: form.description, amount_excl: excl, vat_pct: vat, status: form.status, revenue_id: form.revenue_id, invoice_month: form.invoice_month, invoice_date: oneTimeInvoiceDate() }
      const res = await fetch('/api/admin/invoices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      onSaved(j.warning)
    } catch (e) { setError(e instanceof Error ? e.message : 'Fout') } finally { setLoading(false) }
  }

  const periodLabel = (m: ExpandedRevenue) => m.type === 'recurring' ? `recurring ${m.start_month ? monthLabel(m.start_month) : ''}${m.end_month ? ' → ' + monthLabel(m.end_month) : ' → doorlopend'}` : 'eenmalig'
  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold">Nieuwe factuur</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            {(['eenmalig', 'recurring'] as const).map((t) => (
              <button key={t} type="button" onClick={() => setType(t)} className={`rounded-xl border p-2.5 text-sm text-left transition-colors ${type === t ? 'border-[#fff848] bg-[#fff848]/10 ring-1 ring-[#fff848]' : 'border-gray-200 hover:border-gray-300'}`}>
                <div className="font-medium flex items-center gap-1.5">{t === 'recurring' ? <Repeat className="h-3.5 w-3.5" /> : <FileText className="h-3.5 w-3.5" />}{t === 'recurring' ? 'Recurring' : 'Eenmalig'}</div>
                <div className="text-[10px] text-gray-500">{t === 'recurring' ? 'Elke maand automatisch' : 'Ad hoc, één maand'}</div>
              </button>
            ))}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Klant</label>
            <select className={inp} value={form.client_id} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}><option value="">— Kies klant —</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}</select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Dienst</label>
            <select className={inp} value={form.service_slug} onChange={(e) => setForm((f) => ({ ...f, service_slug: e.target.value }))}>{SERVICE_OPTS.map((s) => <option key={s || 'none'} value={s}>{s ? svcLabel(s) : '— Geen —'}</option>)}</select>
          </div>

          {type === 'recurring' ? (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Startmaand</label><input type="month" className={inp} value={form.start_month} onChange={(e) => setForm((f) => ({ ...f, start_month: e.target.value }))} /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Eindmaand (optioneel)</label><input type="month" className={inp} value={form.end_month} onChange={(e) => setForm((f) => ({ ...f, end_month: e.target.value }))} /></div>
              </div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Facturatiemoment</label>
                <select className={inp} value={form.invoice_day} onChange={(e) => setForm((f) => ({ ...f, invoice_day: e.target.value }))}>{INVOICE_DAYS.map((d) => <option key={d} value={d}>{INVOICE_DAY_LABEL[d]}</option>)}</select>
              </div>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Factuurmaand</label><input type="month" className={inp} value={form.invoice_month} onChange={(e) => setForm((f) => ({ ...f, invoice_month: e.target.value }))} /></div>
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Facturatiemoment</label>
                  <select className={inp} value={form.pay_moment} onChange={(e) => setForm((f) => ({ ...f, pay_moment: e.target.value }))}>{PAY_MOMENTS.map((p) => <option key={p.v} value={p.v}>{p.l}</option>)}</select>
                </div>
              </div>
              {form.pay_moment === 'specific' && (
                <div><label className="block text-xs font-medium text-gray-600 mb-1">Specifieke factuurdatum</label><input type="date" className={inp} value={form.invoice_date_specific} onChange={(e) => setForm((f) => ({ ...f, invoice_date_specific: e.target.value }))} /></div>
              )}
            </>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Omschrijving</label>
            <input className={inp} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} placeholder="Bv. Social media maandelijks" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Bedrag excl. btw {type === 'recurring' ? '/ maand' : ''} (€)</label><input type="number" min="0" step="0.01" className={inp} value={form.amount_excl} onChange={(e) => setForm((f) => ({ ...f, amount_excl: e.target.value }))} placeholder="1000" /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">BTW %</label><input type="number" min="0" step="1" className={inp} value={form.vat_pct} onChange={(e) => setForm((f) => ({ ...f, vat_pct: e.target.value }))} /></div>
          </div>
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2 text-sm flex items-center justify-between">
            <span className="text-gray-500">Btw {formatEuro(incl - excl)} · Incl. btw</span><span className="font-bold">{formatEuro(incl)}</span>
          </div>

          {type === 'eenmalig' && (
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
              <select className={inp} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>{INVOICE_STATUSES.map((s) => <option key={s} value={s}>{INVOICE_STATUS_LABEL[s]}</option>)}</select>
            </div>
          )}
          {type === 'recurring' && (
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />Actief</label>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Prognosekoppeling</label>
            {!form.client_id ? (
              <p className="text-xs text-gray-400">Kies eerst een klant.</p>
            ) : matchLoading ? (
              <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 className="h-3.5 w-3.5 animate-spin" />Prognoses zoeken…</p>
            ) : pool.length === 1 ? (
              <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-xs text-green-800">
                🟢 Automatisch gekoppeld: <b>{pool[0].title || 'Prognose'}</b> · {svcLabel(pool[0].service_slug)} · {formatEuro(pool[0].amount_excl)} · {periodLabel(pool[0])}
              </div>
            ) : pool.length > 1 ? (
              <div className="space-y-1.5">
                <div className="text-xs text-amber-700">🟠 Keuze vereist — kies de juiste prognose:</div>
                {pool.map((m) => (
                  <button key={m.revenue_id} type="button" onClick={() => setForm((f) => ({ ...f, revenue_id: m.revenue_id }))}
                    className={`w-full text-left rounded-lg border px-3 py-2 text-xs transition-colors ${form.revenue_id === m.revenue_id ? 'border-[#fff848] bg-[#fff848]/10 ring-1 ring-[#fff848]' : 'border-gray-200 hover:border-gray-300'}`}>
                    <b>{m.title || 'Prognose'}</b> · {svcLabel(m.service_slug)} · {formatEuro(m.amount_excl)}<span className="text-gray-400"> · {periodLabel(m)}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
                🔴 Geen prognose gevonden voor deze klant in {monthLabel(effMonth)}. Bij <b>Aanmaken</b> wordt automatisch een prognose aangemaakt (zelfde klant, maand, dienst en bedrag) en gekoppeld.
              </div>
            )}
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 flex items-center gap-1.5"><AlertTriangle className="h-4 w-4 shrink-0" />{error}</div>}
          <div className="flex gap-2 pt-1">
            <button onClick={submit} disabled={loading} className="btn-primary flex-1 justify-center">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}{pool.length === 0 && form.client_id ? 'Factuur + prognose aanmaken' : 'Aanmaken'}</button>
            <button onClick={onClose} className="btn-secondary">Annuleer</button>
          </div>
        </div>
      </div>
    </div>
  )
}
