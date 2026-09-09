'use client'

import { useMemo, useState, useEffect } from 'react'
import Link from 'next/link'
import { Plus, FileText, Filter as FilterIcon, X, Search, Bell } from 'lucide-react'
import { formatDate, SERVICE_LABELS } from '@/lib/utils'
import { statusInfo, canonicalStatus, STATUS_FILTER_OPTIONS, followUp, averageSignDays, CONTRACT_TYPES, DURATION_TYPES } from '@/lib/contract-status'
import { ContractTabs } from './contract-tabs'

type Contract = {
  id: string
  title: string
  status: string
  service_slug: string | null
  signed_at: string | null
  sent_at: string | null
  created_at: string
  expires_at: string | null
  access_token: string
  client_id: string | null
  template_id: string | null
  contract_type: string | null
  duration_type: string | null
  signer_name: string | null
  signer_email: string | null
  invoice_count: number
  invoice_sent: number
  expected_invoice_count: number | null
  invoice_state: 'none' | 'partial' | 'full'
  client: { id: string; company_name: string } | null
}

type Client = { id: string; company_name: string }
type Template = { id: string; name: string }

const ALL_SERVICES = ['social-media', 'webdesign', 'foto-video', 'grafisch-ontwerp', 'marketing-consultancy', 'ads']

export function ContractsClient({
  initialContracts, clients, templates = [], initialStatus = 'all',
}: {
  initialContracts: Contract[]
  clients: Client[]
  templates?: Template[]
  initialStatus?: string
}) {
  const [filterClient, setFilterClient] = useState<string>('all')
  const [filterService, setFilterService] = useState<string>('all')
  const [filterStatus, setFilterStatus] = useState<string>(initialStatus)
  const [filterTemplate, setFilterTemplate] = useState<string>('all')
  const [filterType, setFilterType] = useState<string>('all')        // contracttype
  const [filterDuration, setFilterDuration] = useState<string>('all') // contractduur-type
  const [filterLinked, setFilterLinked] = useState<string>('all') // all | yes | no
  const [filterInvoice, setFilterInvoice] = useState<string>('all') // all | none | partial | full
  const [dateFrom, setDateFrom] = useState<string>('')
  const [dateTo, setDateTo] = useState<string>('')
  const [query, setQuery] = useState('')
  const [dq, setDq] = useState('') // debounced query

  const templateName = useMemo(() => new Map(templates.map((t) => [t.id, t.name])), [templates])

  // Laatst gebruikte filters bewaren/herstellen (localStorage).
  useEffect(() => {
    try {
      const raw = localStorage.getItem('ngm.contractFilters')
      if (raw) {
        const s = JSON.parse(raw)
        if (s.filterClient) setFilterClient(s.filterClient)
        if (s.filterService) setFilterService(s.filterService)
        if (s.filterStatus && initialStatus === 'all') setFilterStatus(s.filterStatus)
        if (s.filterTemplate) setFilterTemplate(s.filterTemplate)
        if (s.filterType) setFilterType(s.filterType)
        if (s.filterDuration) setFilterDuration(s.filterDuration)
        if (s.filterLinked) setFilterLinked(s.filterLinked)
        if (s.filterInvoice) setFilterInvoice(s.filterInvoice)
        if (s.dateFrom) setDateFrom(s.dateFrom)
        if (s.dateTo) setDateTo(s.dateTo)
      }
    } catch { /* negeer */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem('ngm.contractFilters', JSON.stringify({ filterClient, filterService, filterStatus, filterTemplate, filterType, filterDuration, filterLinked, filterInvoice, dateFrom, dateTo }))
    } catch { /* negeer */ }
  }, [filterClient, filterService, filterStatus, filterTemplate, filterType, filterDuration, filterLinked, filterInvoice, dateFrom, dateTo])
  // Debounce de zoekterm (vlot bij grote lijsten).
  useEffect(() => { const t = setTimeout(() => setDq(query), 200); return () => clearTimeout(t) }, [query])

  const filtered = useMemo(() => {
    const q = dq.trim().toLowerCase()
    return initialContracts.filter((c) => {
      if (filterClient !== 'all' && c.client_id !== filterClient) return false
      if (filterService !== 'all' && (c.service_slug ?? '') !== filterService) return false
      if (filterStatus !== 'all' && canonicalStatus(c.status) !== filterStatus) return false
      if (filterTemplate !== 'all') {
        if (filterTemplate === 'none' ? !!c.template_id : c.template_id !== filterTemplate) return false
      }
      if (filterType !== 'all' && (c.contract_type ?? '') !== filterType) return false
      if (filterDuration !== 'all' && (c.duration_type ?? '') !== filterDuration) return false
      if (filterLinked === 'yes' && !c.client_id) return false
      if (filterLinked === 'no' && !!c.client_id) return false
      if (filterInvoice !== 'all' && c.invoice_state !== filterInvoice) return false
      if (dateFrom && (c.created_at ?? '').slice(0, 10) < dateFrom) return false
      if (dateTo && (c.created_at ?? '').slice(0, 10) > dateTo) return false
      if (q) {
        const hay = [
          c.title, c.client?.company_name, c.signer_name, c.signer_email,
          c.service_slug, statusInfo(c.status).label, c.template_id ? templateName.get(c.template_id) : '',
        ].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [initialContracts, filterClient, filterService, filterStatus, filterTemplate, filterType, filterDuration, filterLinked, filterInvoice, dateFrom, dateTo, dq, templateName])

  // ── Dashboard-cijfers (over alle contracten) ───────────────────────────────
  const stats = useMemo(() => {
    const todayISO = new Date().toISOString().slice(0, 10)
    const key = (c: Contract) => canonicalStatus(c.status)
    return {
      open:      initialContracts.filter((c) => !['getekend', 'geannuleerd'].includes(key(c))).length,
      sentToday: initialContracts.filter((c) => c.sent_at && String(c.sent_at).slice(0, 10) === todayISO).length,
      toSign:    initialContracts.filter((c) => ['verzonden', 'geopend', 'ingevuld'].includes(key(c))).length,
      expired:   initialContracts.filter((c) => key(c) === 'verlopen').length,
      signed:    initialContracts.filter((c) => key(c) === 'getekend').length,
      avgDays:   averageSignDays(initialContracts),
    }
  }, [initialContracts])

  const followUps = useMemo(
    () => initialContracts.map((c) => ({ c, fu: followUp(c) })).filter((x) => x.fu.needs)
      .sort((a, b) => (a.fu.level === 'urgent' ? -1 : 1) - (b.fu.level === 'urgent' ? -1 : 1)),
    [initialContracts],
  )

  const hasActiveFilters = filterClient !== 'all' || filterService !== 'all' || filterStatus !== 'all' || filterTemplate !== 'all' || filterType !== 'all' || filterDuration !== 'all' || filterLinked !== 'all' || filterInvoice !== 'all' || dateFrom !== '' || dateTo !== '' || query.trim() !== ''

  const clearFilters = () => {
    setFilterClient('all')
    setFilterService('all')
    setFilterStatus('all')
    setFilterTemplate('all')
    setFilterType('all')
    setFilterDuration('all')
    setFilterLinked('all')
    setFilterInvoice('all')
    setDateFrom('')
    setDateTo('')
    setQuery('')
  }

  // Stat-kaart klik → filtert de lijst op die status.
  const filterByKey = (key: string) => { clearFilters(); setFilterStatus(key) }

  const sel = 'px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'

  return (
    <div className="space-y-6 animate-fade-in">
      <ContractTabs />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Contracten</h1>
          <p className="text-sm text-gray-500 mt-0.5">{filtered.length} van {initialContracts.length} contracten</p>
        </div>
        <Link href="/admin/contracts/new" className="btn-primary shrink-0">
          <Plus className="h-4 w-4" />
          Nieuw contract
        </Link>
      </div>

      {/* Dashboard — klikbare cijfers */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <button onClick={() => clearFilters()} className="stat-card text-left hover:ring-2 hover:ring-gray-200">
          <div className="text-2xl font-bold">{stats.open}</div>
          <div className="text-xs text-gray-400 mt-1">Openstaand</div>
        </button>
        <button onClick={() => filterByKey('verzonden')} className="stat-card text-left hover:ring-2 hover:ring-gray-200">
          <div className="text-2xl font-bold text-blue-600">{stats.sentToday}</div>
          <div className="text-xs text-gray-400 mt-1">Vandaag verzonden</div>
        </button>
        <button onClick={() => filterByKey('verzonden')} className="stat-card text-left hover:ring-2 hover:ring-gray-200">
          <div className="text-2xl font-bold text-amber-600">{stats.toSign}</div>
          <div className="text-xs text-gray-400 mt-1">Nog te tekenen</div>
        </button>
        <button onClick={() => filterByKey('verlopen')} className="stat-card text-left hover:ring-2 hover:ring-gray-200">
          <div className="text-2xl font-bold text-red-600">{stats.expired}</div>
          <div className="text-xs text-gray-400 mt-1">Verlopen</div>
        </button>
        <button onClick={() => filterByKey('getekend')} className="stat-card text-left hover:ring-2 hover:ring-gray-200">
          <div className="text-2xl font-bold text-green-600">{stats.signed}</div>
          <div className="text-xs text-gray-400 mt-1">Getekend</div>
        </button>
        <div className="stat-card">
          <div className="text-2xl font-bold">{stats.avgDays !== null ? `${stats.avgDays}d` : '—'}</div>
          <div className="text-xs text-gray-400 mt-1">Gem. tekentijd</div>
        </div>
      </div>

      {/* Reminders — opvolging vereist (geen automail) */}
      {followUps.length > 0 && (
        <div className="card-base border-amber-200 bg-amber-50/40">
          <div className="flex items-center gap-2 mb-2">
            <Bell className="h-4 w-4 text-amber-600" />
            <h2 className="text-sm font-semibold text-amber-800">Contracten vereisen opvolging ({followUps.length})</h2>
          </div>
          <div className="space-y-1.5">
            {followUps.slice(0, 6).map(({ c, fu }) => (
              <Link key={c.id} href={`/admin/contracts/${c.id}`} className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg hover:bg-white/70">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{c.title}</div>
                  <div className="text-xs text-gray-500">{c.client?.company_name ?? c.signer_name ?? '—'}</div>
                </div>
                <span className={`status-badge shrink-0 ${fu.level === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{fu.reason}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card-base">
        <div className="flex items-center gap-2 mb-3">
          <FilterIcon className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Filters</h2>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="ml-auto text-xs text-gray-500 hover:text-black flex items-center gap-1">
              <X className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>
        {/* Zoeken */}
        <div className="relative mb-3">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Zoek op titel, klant, ontvanger, e-mail, type, status…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]"
          />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Klant</label>
            <select className={`${sel} w-full`} value={filterClient} onChange={(e) => setFilterClient(e.target.value)}>
              <option value="all">Alle klanten</option>
              {clients.map((c) => (
                <option key={c.id} value={c.id}>{c.company_name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Dienst</label>
            <select className={`${sel} w-full`} value={filterService} onChange={(e) => setFilterService(e.target.value)}>
              <option value="all">Alle diensten</option>
              {ALL_SERVICES.map((s) => (
                <option key={s} value={s}>{SERVICE_LABELS[s] ?? s}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Status</label>
            <select className={`${sel} w-full`} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="all">Alle statussen</option>
              {STATUS_FILTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Template</label>
            <select className={`${sel} w-full`} value={filterTemplate} onChange={(e) => setFilterTemplate(e.target.value)}>
              <option value="all">Alle types</option>
              <option value="none">Zonder template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Contracttype</label>
            <select className={`${sel} w-full`} value={filterType} onChange={(e) => setFilterType(e.target.value)}>
              <option value="all">Alle types</option>
              {CONTRACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Contractduur</label>
            <select className={`${sel} w-full`} value={filterDuration} onChange={(e) => setFilterDuration(e.target.value)}>
              <option value="all">Alle duurtypes</option>
              {DURATION_TYPES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Gekoppeld aan klant</label>
            <select className={`${sel} w-full`} value={filterLinked} onChange={(e) => setFilterLinked(e.target.value)}>
              <option value="all">Alle</option>
              <option value="yes">Wel gekoppeld</option>
              <option value="no">Los / intern</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Facturatie</label>
            <select className={`${sel} w-full`} value={filterInvoice} onChange={(e) => setFilterInvoice(e.target.value)}>
              <option value="all">Alle</option>
              <option value="none">Zonder facturen</option>
              <option value="partial">Deels gefactureerd</option>
              <option value="full">Volledig gefactureerd</option>
            </select>
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Aangemaakt vanaf</label>
            <input type="date" className={`${sel} w-full`} value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Aangemaakt tot</label>
            <input type="date" className={`${sel} w-full`} value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <FileText className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">
              {initialContracts.length === 0 ? 'Nog geen contracten' : 'Geen contracten matchen de filters'}
            </p>
            {initialContracts.length === 0 && (
              <Link href="/admin/contracts/new" className="btn-primary mt-4 inline-flex">
                <Plus className="h-4 w-4" />
                Eerste contract aanmaken
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="table-th">Contract</th>
                <th className="table-th">Klant</th>
                <th className="table-th">Dienst</th>
                <th className="table-th">Status</th>
                <th className="table-th">Facturen</th>
                <th className="table-th">Datum</th>
                <th className="table-th">Acties</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((c) => {
                const style = statusInfo(c.status)
                return (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-td">
                      <Link href={`/admin/contracts/${c.id}`} className="font-medium hover:text-black">
                        {c.title}
                      </Link>
                    </td>
                    <td className="table-td">
                      {c.client ? (
                        <Link href={`/admin/clients/${c.client.id}`} className="text-gray-600 hover:text-black">
                          {c.client.company_name}
                        </Link>
                      ) : '—'}
                    </td>
                    <td className="table-td">
                      {c.service_slug ? (
                        <span className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">
                          {SERVICE_LABELS[c.service_slug] ?? c.service_slug}
                        </span>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="table-td">
                      <span className={`status-badge ${style.cls}`}>
                        {style.label}
                      </span>
                    </td>
                    <td className="table-td">
                      {c.invoice_count === 0 ? (
                        <span className="text-xs text-gray-300">—</span>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 text-xs ${c.invoice_state === 'full' ? 'text-green-600' : 'text-amber-600'}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${c.invoice_state === 'full' ? 'bg-green-500' : 'bg-amber-500'}`} />
                          {c.invoice_sent}{c.expected_invoice_count ? `/${c.expected_invoice_count}` : `/${c.invoice_count}`}
                        </span>
                      )}
                    </td>
                    <td className="table-td text-gray-500">
                      {c.signed_at
                        ? formatDate(c.signed_at)
                        : c.sent_at
                        ? formatDate(c.sent_at)
                        : formatDate(c.created_at)}
                    </td>
                    <td className="table-td">
                      <div className="flex items-center gap-2">
                        <Link href={`/admin/contracts/${c.id}`} className="text-xs text-gray-500 hover:text-black underline">
                          Bekijken
                        </Link>
                        {['verzonden', 'geopend'].includes(canonicalStatus(c.status)) && (
                          <a
                            href={`/sign/${c.access_token}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs text-blue-600 hover:underline"
                          >
                            Signelink
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
      </div>
    </div>
  )
}
