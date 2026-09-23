'use client'

import { useMemo, useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Plus, FileText, Filter as FilterIcon, X, Search, Bell, Folder, FolderOpen, ChevronRight,
  Download, Trash2, Loader2,
} from 'lucide-react'
import { formatDate, SERVICE_LABELS } from '@/lib/utils'
import { statusInfo, canonicalStatus, STATUS_FILTER_OPTIONS, followUp, averageSignDays, DURATION_TYPES } from '@/lib/contract-status'
import { typeVanContract, isNietToegewezen } from '@/lib/contracten/types'
import {
  bouwKlantmappen, typeOpties, totalen, ZONDER_KLANT,
  type OverzichtContract, type Sortering,
} from '@/lib/contracten/overzicht'
import { ContractTabs } from './contract-tabs'
import { ArchiefKnop } from './archief-knop'
import { bewaarNavigatie, bewaarContext, leesContext } from '@/lib/contract-navigatie'

export type Contract = OverzichtContract & {
  service_slug: string | null
  expires_at: string | null
  access_token: string
  template_id: string | null
  duration_type: string | null
  signer_name: string | null
  signer_email: string | null
  invoice_count: number
  invoice_sent: number
  expected_invoice_count: number | null
  invoice_state: 'none' | 'partial' | 'full'
}

type Client = { id: string; company_name: string }
type Template = { id: string; name: string }

const ALL_SERVICES = ['social-media', 'webdesign', 'foto-video', 'grafisch-ontwerp', 'marketing-consultancy', 'ads']
const MAPPEN_SLEUTEL = 'ngm.contractMappen'

export function ContractsClient({
  initialContracts, clients, templates = [], contracttypes = [], initialStatus = 'all',
}: {
  initialContracts: Contract[]
  clients: Client[]
  templates?: Template[]
  contracttypes?: string[]
  initialStatus?: string
}) {
  const router = useRouter()
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
  const [sorteer, setSorteer] = useState<Sortering>('klant')
  const [query, setQuery] = useState('')
  const [dq, setDq] = useState('') // debounced query
  const [openMappen, setOpenMappen] = useState<string[]>([])
  const [verwijderBezig, setVerwijderBezig] = useState<string | null>(null)

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
        if (s.sorteer) setSorteer(s.sorteer)
      }
    } catch { /* negeer */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem('ngm.contractFilters', JSON.stringify({ filterClient, filterService, filterStatus, filterTemplate, filterType, filterDuration, filterLinked, filterInvoice, dateFrom, dateTo, sorteer }))
    } catch { /* negeer */ }
  }, [filterClient, filterService, filterStatus, filterTemplate, filterType, filterDuration, filterLinked, filterInvoice, dateFrom, dateTo, sorteer])
  // Debounce de zoekterm (vlot bij grote lijsten).
  useEffect(() => { const t = setTimeout(() => setDq(query), 200); return () => clearTimeout(t) }, [query])

  // Open/dicht per klantmap overleeft de sessie van dit tabblad.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(MAPPEN_SLEUTEL)
      if (raw) { const s = JSON.parse(raw); if (Array.isArray(s)) setOpenMappen(s.filter((x) => typeof x === 'string')) }
    } catch { /* negeer */ }
  }, [])
  useEffect(() => {
    try { sessionStorage.setItem(MAPPEN_SLEUTEL, JSON.stringify(openMappen)) } catch { /* negeer */ }
  }, [openMappen])

  // Terugkeer vanuit een contract: zoekterm en scrollpositie van daarnet herstellen.
  const [hersteld, setHersteld] = useState(false)
  useEffect(() => {
    const ctx = leesContext()
    if (ctx?.query) { setQuery(ctx.query); setDq(ctx.query) }
    setHersteld(true)
  }, [])
  useEffect(() => {
    if (!hersteld) return
    const ctx = leesContext()
    // Next zet de pagina na een navigatie zelf bovenaan; daarom herstellen we
    // de positie pas daarna (twee pogingen), en pas dan luisteren we naar scrollen.
    const doel = ctx && ctx.scrollY > 0 ? ctx.scrollY : 0
    let klok: ReturnType<typeof setTimeout> | undefined
    const opScroll = () => { if (klok) return; klok = setTimeout(() => { klok = undefined; bewaarContext({ scrollY: window.scrollY }) }, 150) }
    const t1 = setTimeout(() => { if (doel) window.scrollTo({ top: doel }) }, 80)
    const t2 = setTimeout(() => { if (doel && Math.abs(window.scrollY - doel) > 20) window.scrollTo({ top: doel }); window.addEventListener('scroll', opScroll, { passive: true }) }, 450)
    // Zeker weten: bij het aanklikken van een contract de positie van dát moment bewaren.
    const opKlik = (e: MouseEvent) => { if ((e.target as Element | null)?.closest?.('a[href^="/admin/contracts/"]')) bewaarContext({ scrollY: window.scrollY }) }
    document.addEventListener('click', opKlik, true)
    return () => { clearTimeout(t1); clearTimeout(t2); window.removeEventListener('scroll', opScroll); document.removeEventListener('click', opKlik, true); if (klok) clearTimeout(klok) }
  }, [hersteld])
  useEffect(() => { if (hersteld) bewaarContext({ query }) }, [query, hersteld])

  // Filters die niets met de mappen te maken hebben (klant, dienst, template,
  // duur, koppeling, facturatie, datums). Zoeken + type + status doet de
  // mappen-module zelf, zodat treffers gemarkeerd kunnen worden.
  const voorgefilterd = useMemo(() => {
    return initialContracts.filter((c) => {
      if (filterClient !== 'all' && c.client_id !== filterClient) return false
      if (filterService !== 'all' && (c.service_slug ?? '') !== filterService) return false
      if (filterTemplate !== 'all') {
        if (filterTemplate === 'none' ? !!c.template_id : c.template_id !== filterTemplate) return false
      }
      if (filterDuration !== 'all' && (c.duration_type ?? '') !== filterDuration) return false
      if (filterLinked === 'yes' && !c.client_id) return false
      if (filterLinked === 'no' && !!c.client_id) return false
      if (filterInvoice !== 'all' && c.invoice_state !== filterInvoice) return false
      if (dateFrom && (c.created_at ?? '').slice(0, 10) < dateFrom) return false
      if (dateTo && (c.created_at ?? '').slice(0, 10) > dateTo) return false
      return true
    }).map((c) => ({
      ...c,
      zoekExtra: [c.signer_name, c.signer_email, c.service_slug ? SERVICE_LABELS[c.service_slug] ?? c.service_slug : '', c.template_id ? templateName.get(c.template_id) : '']
        .filter(Boolean).join(' '),
    }))
  }, [initialContracts, filterClient, filterService, filterTemplate, filterDuration, filterLinked, filterInvoice, dateFrom, dateTo, templateName])

  const mappen = useMemo(
    () => bouwKlantmappen(voorgefilterd, { zoek: dq, type: filterType, status: filterStatus, sorteer }),
    [voorgefilterd, dq, filterType, filterStatus, sorteer],
  )
  const cijfers = useMemo(() => totalen(mappen), [mappen])
  const zichtbareContracten = useMemo(() => mappen.flatMap((m) => m.contracten), [mappen])

  const typeKeuzes = useMemo(() => typeOpties(initialContracts, contracttypes), [initialContracts, contracttypes])

  // De zichtbare volgorde (mappen + filters) is wat "vorig/volgend" op de
  // detailpagina volgt. Enkel id's, in de sessie van dit tabblad.
  useEffect(() => {
    bewaarNavigatie(zichtbareContracten.map((c) => c.id), `${zichtbareContracten.length} contracten`)
  }, [zichtbareContracten])

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

  const wissel = useCallback((sleutel: string) => {
    setOpenMappen((p) => (p.includes(sleutel) ? p.filter((x) => x !== sleutel) : [...p, sleutel]))
  }, [])

  const verwijder = async (c: Contract) => {
    const getekend = canonicalStatus(c.status) === 'getekend'
    const vraag = getekend
      ? `"${c.title}" is ONDERTEKEND. Verwijderen? De getekende versie en het certificaat blijven in het contractarchief.`
      : `"${c.title}" definitief verwijderen?`
    if (!confirm(vraag)) return
    setVerwijderBezig(c.id)
    try {
      const res = await fetch(`/api/admin/contracts/${c.id}`, {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: getekend }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Verwijderen mislukt')
      toast.success(`Contract "${c.title}" verwijderd.`)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt')
    } finally { setVerwijderBezig(null) }
  }

  const sel = 'px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'

  return (
    <div className="space-y-6 animate-fade-in">
      <ContractTabs />
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Contracten</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {cijfers.mappen} klantmap{cijfers.mappen === 1 ? '' : 'pen'} · {cijfers.contracten} van {initialContracts.length} contracten
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ArchiefKnop />
          <Link href="/admin/contracts/new" className="btn-primary shrink-0">
            <Plus className="h-4 w-4" />
            Nieuw contract
          </Link>
        </div>
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

      {/* Werkbalk + filters */}
      <div className="card-base">
        <div className="flex items-center gap-2 mb-3">
          <FilterIcon className="h-4 w-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-700">Zoeken & filteren</h2>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="ml-auto text-xs text-gray-500 hover:text-black flex items-center gap-1">
              <X className="h-3 w-3" />
              Reset
            </button>
          )}
        </div>
        {/* Zoeken + de drie hoofdkeuzes van het mappenoverzicht */}
        <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))] mb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Zoek op klantnaam, contractnaam of contracttype…"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]"
            />
          </div>
          <select className={`${sel} w-full`} value={filterType} onChange={(e) => setFilterType(e.target.value)} aria-label="Contracttype">
            <option value="all">Alle contracttypes</option>
            {typeKeuzes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className={`${sel} w-full`} value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)} aria-label="Status">
            <option value="all">Alle statussen</option>
            {STATUS_FILTER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select className={`${sel} w-full`} value={sorteer} onChange={(e) => setSorteer(e.target.value as Sortering)} aria-label="Sorteren">
            <option value="klant">Sorteer: klantnaam A→Z</option>
            <option value="aantal">Sorteer: aantal contracten</option>
            <option value="recent">Sorteer: meest recente contract</option>
          </select>
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
            <label className="block text-xs text-gray-500 mb-1">Template</label>
            <select className={`${sel} w-full`} value={filterTemplate} onChange={(e) => setFilterTemplate(e.target.value)}>
              <option value="all">Alle templates</option>
              <option value="none">Zonder template</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
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

      {/* Klantmappen */}
      {mappen.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm text-center py-16 text-gray-400">
          <FileText className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">
            {initialContracts.length === 0 ? 'Nog geen contracten — maak het eerste contract aan.' : 'Geen resultaten voor deze zoekopdracht of filters.'}
          </p>
          {initialContracts.length === 0 ? (
            <Link href="/admin/contracts/new" className="btn-primary mt-4 inline-flex">
              <Plus className="h-4 w-4" />
              Eerste contract aanmaken
            </Link>
          ) : (
            <button onClick={clearFilters} className="btn-secondary mt-4 inline-flex">
              <X className="h-4 w-4" />
              Filters wissen
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {mappen.map((map) => {
            const geopend = openMappen.includes(map.sleutel) || (dq.trim() !== '' && map.treffers.length > 0)
            const treffers = new Set(map.treffers)
            return (
              <div key={map.sleutel} className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                {/* Mapkop */}
                <button
                  type="button"
                  onClick={() => wissel(map.sleutel)}
                  aria-expanded={geopend}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                >
                  <ChevronRight className={`h-4 w-4 text-gray-400 shrink-0 transition-transform ${geopend ? 'rotate-90' : ''}`} />
                  {geopend
                    ? <FolderOpen className="h-5 w-5 text-[#d6cf00] shrink-0" />
                    : <Folder className="h-5 w-5 text-gray-400 shrink-0" />}
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold truncate">
                      {map.klantId
                        ? map.klantNaam
                        : <span className="text-gray-600 italic">{map.klantNaam}</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-x-3 gap-y-0.5 flex-wrap">
                      <span className="px-1.5 py-0.5 rounded bg-gray-100 text-gray-700 font-medium">{map.aantal} contract{map.aantal === 1 ? '' : 'en'}</span>
                      <span className="text-green-600">{map.actief} actief</span>
                      <span className="text-gray-400">{map.beeindigd} beëindigd</span>
                      <span>Laatste: {map.laatsteDatum ? formatDate(map.laatsteDatum) : '—'}</span>
                    </div>
                  </div>
                </button>

                {/* Mapinhoud */}
                {geopend && (
                  <div className="border-t border-gray-100">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[860px]">
                        <thead className="bg-gray-50 border-b border-gray-200">
                          <tr>
                            <th className="table-th">Contract</th>
                            <th className="table-th">Contracttype</th>
                            <th className="table-th">Status</th>
                            <th className="table-th">Facturen</th>
                            <th className="table-th">Start</th>
                            <th className="table-th">Einde</th>
                            <th className="table-th">Ondertekend</th>
                            <th className="table-th">Acties</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                          {map.contracten.map((raw) => {
                            const c = raw as Contract
                            const style = statusInfo(c.status)
                            const type = typeVanContract(c.contract_type)
                            const treffer = treffers.has(c.id)
                            return (
                              <tr key={c.id} className={`transition-colors ${treffer ? 'bg-[#fff848]/20 hover:bg-[#fff848]/30' : 'hover:bg-gray-50'}`}>
                                <td className="table-td">
                                  <Link href={`/admin/contracts/${c.id}`} className="font-medium hover:text-black">
                                    {c.title}
                                  </Link>
                                  {c.service_slug && (
                                    <div className="text-xs text-gray-400 mt-0.5">{SERVICE_LABELS[c.service_slug] ?? c.service_slug}</div>
                                  )}
                                </td>
                                <td className="table-td">
                                  <span className={`status-badge ${isNietToegewezen(type) ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>{type}</span>
                                </td>
                                <td className="table-td">
                                  <span className={`status-badge ${style.cls}`}>{style.label}</span>
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
                                <td className="table-td text-gray-500">{c.start_date ? formatDate(c.start_date) : '—'}</td>
                                <td className="table-td text-gray-500">{c.end_date ? formatDate(c.end_date) : '—'}</td>
                                <td className="table-td text-gray-500">{c.signed_at ? formatDate(c.signed_at) : '—'}</td>
                                <td className="table-td">
                                  <div className="flex items-center gap-2 whitespace-nowrap">
                                    <Link href={`/admin/contracts/${c.id}`} className="text-xs text-gray-500 hover:text-black underline">
                                      Bekijken
                                    </Link>
                                    {['verzonden', 'geopend'].includes(canonicalStatus(c.status)) && (
                                      <a href={`/sign/${c.access_token}`} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline">
                                        Signelink
                                      </a>
                                    )}
                                    <a
                                      href={`/api/admin/contracts/${c.id}/download?type=${canonicalStatus(c.status) === 'getekend' ? 'signed' : 'original'}`}
                                      className="text-gray-400 hover:text-black"
                                      title="PDF downloaden"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                    </a>
                                    <button
                                      type="button"
                                      onClick={() => void verwijder(c)}
                                      disabled={verwijderBezig === c.id}
                                      className="text-gray-400 hover:text-red-600 disabled:opacity-50"
                                      title="Contract verwijderen"
                                    >
                                      {verwijderBezig === c.id
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <Trash2 className="h-3.5 w-3.5" />}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                    <div className="px-4 py-3 border-t border-gray-100 bg-gray-50/60">
                      <Link
                        href={map.sleutel === ZONDER_KLANT ? '/admin/contracts/new' : `/admin/contracts/new?client=${map.klantId}`}
                        className="btn-secondary text-xs"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Nieuw contract{map.sleutel === ZONDER_KLANT ? '' : ' voor deze klant'}
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
