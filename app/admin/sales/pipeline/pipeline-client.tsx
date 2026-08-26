'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Loader2, Plus, Search, Phone, Mail, X, CalendarClock, Archive, PhoneOff, Tag, Clock, Headphones, Upload,
  MailCheck,
} from 'lucide-react'
import { MANUAL_STAGES, stageLabel, STAGES } from '@/lib/sales/stages'
import { FocusMode } from './focus-mode'
import { ImportModal } from './import-modal'
import { ReminderSettings } from './reminder-settings'

type Lead = {
  id: string; stage_key: string; labels: string[]; callback_at: string | null
  pipeline_id?: string | null
  do_not_call: boolean; updated_at: string; lost_reason: string | null; email_brief: string | null
  sales_companies: { id: string; name: string; website: string | null; sector: string | null; city: string | null; region: string | null; phone: string | null } | null
  sales_contacts: { id: string; name: string | null; email: string | null; phone: string | null; mobile: string | null; role: string | null } | null
}

const STAGE_STYLE: Record<string, string> = {
  to_contact: 'bg-gray-100 text-gray-700',
  contacted: 'bg-blue-100 text-blue-700',
  interested: 'bg-green-100 text-green-700',
  not_interested: 'bg-gray-200 text-gray-700',
  email_todo: 'bg-amber-100 text-amber-700',
  email_sent: 'bg-amber-100 text-amber-800',
  appointment: 'bg-[#fff848] text-black',
  won: 'bg-green-200 text-green-900',
  lost: 'bg-red-100 text-red-700',
}

type Pipeline = { id: string; name: string; key: string }

/**
 * Twee pipelines: NextGenMedia en NextGenSolutions. De keuze bovenaan bepaalt
 * in welk merk je werkt — nieuwe leads, imports en afspraken erven dat merk,
 * en daarmee de brochure die bij de herinneringsmail gaat.
 */
export function PipelineClient({ pipelines, initialPipelineId }: {
  pipelines: Pipeline[]; initialPipelineId: string
}) {
  const [pipelineId, setPipelineId] = useState(initialPipelineId)
  const [leads, setLeads] = useState<Lead[]>([])
  // Voorraad om de filter-keuzelijsten mee te vullen (zonder actieve filters).
  const [pool, setPool] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [stage, setStage] = useState('')
  const [archived, setArchived] = useState(false)
  const [hideDnc, setHideDnc] = useState(true)
  const [callbackToday, setCallbackToday] = useState(false)
  const [sector, setSector] = useState('')
  const [region, setRegion] = useState('')
  const [city, setCity] = useState('')
  const [label, setLabel] = useState('')
  const [selected, setSelected] = useState<Lead | null>(null)
  const [newLead, setNewLead] = useState(false)
  const [focus, setFocus] = useState(false)
  const [importing, setImporting] = useState(false)
  const [reminders, setReminders] = useState(false)
  // Selectie voor bulk-acties (§4).
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ pipeline: pipelineId })
      if (q.trim()) p.set('q', q.trim())
      if (stage) p.set('stage', stage)
      if (archived) p.set('archived', '1')
      if (hideDnc) p.set('hideDnc', '1')
      if (callbackToday) p.set('callbackToday', '1')
      if (sector) p.set('sector', sector)
      if (region) p.set('region', region)
      if (city) p.set('city', city)
      if (label) p.set('label', label)
      const res = await fetch(`/api/admin/sales/leads?${p}`)
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      setLeads(j.leads ?? [])
      // Keuzelijsten vullen we uit de ONGEFILTERDE lijst, anders verdwijnen de
      // andere opties zodra je één filter kiest en kom je er niet meer uit.
      if (!sector && !region && !city && !label) setPool(j.leads ?? [])
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') } finally { setLoading(false) }
  }, [pipelineId, q, stage, archived, hideDnc, callbackToday, sector, region, city, label])

  // Kleine vertraging bij typen, zodat we niet bij elke toetsaanslag zoeken.
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const l of leads) m.set(l.stage_key, (m.get(l.stage_key) ?? 0) + 1)
    return m
  }, [leads])

  // Alleen waarden aanbieden die echt voorkomen — lege dropdowns helpen niemand.
  const options = useMemo(() => {
    const uniq = (vals: (string | null | undefined)[]) =>
      [...new Set(vals.filter((v): v is string => !!v && v.trim() !== ''))].sort()
    return {
      sectors: uniq(pool.map((l) => l.sales_companies?.sector)),
      regions: uniq(pool.map((l) => l.sales_companies?.region)),
      cities: uniq(pool.map((l) => l.sales_companies?.city)),
      labels: uniq(pool.flatMap((l) => l.labels ?? [])),
    }
  }, [pool])

  const anyFilter = !!(sector || region || city || label || stage || callbackToday || archived || q.trim())
  const clearFilters = () => {
    setSector(''); setRegion(''); setCity(''); setLabel('')
    setStage(''); setCallbackToday(false); setArchived(false); setQ('')
  }

  const phoneOf = (l: Lead) => l.sales_contacts?.phone || l.sales_contacts?.mobile || l.sales_companies?.phone || ''

  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  /** Bulk-actie op de selectie. Eén verzoek per lead, maar met één melding. */
  const bulk = async (body: Record<string, unknown>, label: string) => {
    if (picked.size === 0) return
    setBulkBusy(true)
    let failed = 0
    try {
      await Promise.all([...picked].map(async (id) => {
        const res = await fetch(`/api/admin/sales/leads/${id}`, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        if (!res.ok) failed++
      }))
      if (failed) toast.warning(`${label}: ${picked.size - failed} gelukt, ${failed} mislukt.`)
      else toast.success(`${label} (${picked.size}).`)
      setPicked(new Set())
      load()
    } finally { setBulkBusy(false) }
  }

  return (
    <div className="space-y-4">
      {/* Kop: merk, zoeken, knoppen */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* Voor welk bedrijf bel je? Bepaalt ook welke one-pager meegaat. */}
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
            {pipelines.map((p) => (
              <button key={p.id} onClick={() => { setPipelineId(p.id); setSelected(null); setPicked(new Set()) }}
                className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                  p.id === pipelineId ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-black'}`}>
                {p.name}
              </button>
            ))}
          </div>
          <div className="relative">
            <Search className="h-4 w-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input className="input-base pl-8 w-64" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="Bedrijf, contact, e-mail of telefoon…" />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setFocus(true)} disabled={leads.length === 0} className="btn-secondary text-sm" title="Belmodus: één lead per keer, sneltoetsen 1–6">
            <Headphones className="h-4 w-4" />Focus Mode
          </button>
          <button onClick={() => setImporting(true)} className="btn-secondary text-sm" title="Lijst met prospects in bulk toevoegen">
            <Upload className="h-4 w-4" />Importeren
          </button>
          <button onClick={() => setReminders(true)} className="btn-secondary text-sm"
            title="De herinneringsmail die de dag voor een afspraak vertrekt">
            <MailCheck className="h-4 w-4" />Herinneringsmail
          </button>
          <button onClick={() => setNewLead(true)} className="btn-primary text-sm"><Plus className="h-4 w-4" />Nieuwe lead</button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <button onClick={() => setStage('')} className={`text-xs px-2.5 py-1 rounded-full border ${!stage ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
          Alle ({leads.length})
        </button>
        {STAGES.map((s) => (
          <button key={s.key} onClick={() => setStage(stage === s.key ? '' : s.key)}
            className={`text-xs px-2.5 py-1 rounded-full border ${stage === s.key ? 'bg-black text-white border-black' : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
            {s.label}{counts.get(s.key) ? ` (${counts.get(s.key)})` : ''}
          </button>
        ))}
        <span className="mx-1 h-4 w-px bg-gray-200" />
        <label className="text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={callbackToday} onChange={(e) => setCallbackToday(e.target.checked)} />Terugbellen vandaag
        </label>
        <label className="text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={hideDnc} onChange={(e) => setHideDnc(e.target.checked)} />Verberg niet-bellen
        </label>
        <label className="text-xs text-gray-600 flex items-center gap-1 cursor-pointer">
          <input type="checkbox" checked={archived} onChange={(e) => setArchived(e.target.checked)} />Archief
        </label>
      </div>

      {/* Verfijnen op firmografie en labels — enkel tonen als er iets te kiezen valt. */}
      {(options.sectors.length > 0 || options.regions.length > 0 || options.cities.length > 0 || options.labels.length > 0) && (
        <div className="flex items-center gap-2 flex-wrap">
          {options.sectors.length > 0 && (
            <select className="input-base w-auto text-xs" value={sector} onChange={(e) => setSector(e.target.value)}>
              <option value="">Alle sectoren</option>
              {options.sectors.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
          {options.regions.length > 0 && (
            <select className="input-base w-auto text-xs" value={region} onChange={(e) => setRegion(e.target.value)}>
              <option value="">Alle provincies</option>
              {options.regions.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
          {options.cities.length > 0 && (
            <select className="input-base w-auto text-xs" value={city} onChange={(e) => setCity(e.target.value)}>
              <option value="">Alle steden</option>
              {options.cities.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
          {options.labels.length > 0 && (
            <select className="input-base w-auto text-xs" value={label} onChange={(e) => setLabel(e.target.value)}>
              <option value="">Alle labels</option>
              {options.labels.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          )}
          {anyFilter && (
            <button onClick={clearFilters} className="text-xs text-gray-500 hover:text-black">Filters wissen</button>
          )}
        </div>
      )}

      {/* Bulk-balk: verschijnt alleen wanneer er iets geselecteerd is. */}
      {picked.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <span className="text-sm font-medium">{picked.size} geselecteerd</span>
          <select className="input-base w-auto text-sm" defaultValue="" disabled={bulkBusy}
            onChange={(e) => { if (e.target.value) { bulk({ stage: e.target.value }, 'Status gewijzigd'); e.target.value = '' } }}>
            <option value="">Status wijzigen…</option>
            {MANUAL_STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
          </select>
          <button disabled={bulkBusy} className="btn-secondary text-sm"
            onClick={() => { const l = prompt('Label toevoegen aan de selectie:'); if (l?.trim()) bulk({ labels: [l.trim()] }, 'Label toegevoegd') }}>
            <Tag className="h-3.5 w-3.5" />Label
          </button>
          <button disabled={bulkBusy} className="btn-secondary text-sm" onClick={() => bulk({ archived: true }, 'Gearchiveerd')}>
            <Archive className="h-3.5 w-3.5" />Archiveer
          </button>
          <button disabled={bulkBusy} className="btn-secondary text-sm" onClick={() => bulk({ do_not_call: true }, 'Op niet-bellen gezet')}>
            <PhoneOff className="h-3.5 w-3.5" />Niet bellen
          </button>
          <button onClick={() => setPicked(new Set())} className="text-xs text-gray-500 hover:text-black ml-auto">Selectie wissen</button>
          {bulkBusy && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
        </div>
      )}

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Tabel */}
        <div className="lg:col-span-2 card-base p-0 overflow-hidden">
          {loading ? (
            <div className="py-12 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
          ) : leads.length === 0 ? (
            <div className="empty-state text-sm">Geen leads gevonden.</div>
          ) : (
            <div className="table-wrap">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="table-th w-8">
                      <input type="checkbox" aria-label="Alles selecteren"
                        checked={picked.size > 0 && picked.size === leads.length}
                        onChange={(e) => setPicked(e.target.checked ? new Set(leads.map((l) => l.id)) : new Set())} />
                    </th>
                    <th className="table-th">Bedrijf</th>
                    <th className="table-th">Contact</th>
                    <th className="table-th">Telefoon</th>
                    <th className="table-th">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {leads.map((l) => (
                    <tr key={l.id} onClick={() => setSelected(l)}
                      className={`hover:bg-gray-50 cursor-pointer ${selected?.id === l.id ? 'bg-[#fff848]/10' : ''}`}>
                      <td className="table-td" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label="Selecteer lead"
                          checked={picked.has(l.id)} onChange={() => toggle(l.id)} />
                      </td>
                      <td className="table-td">
                        <div className="font-medium truncate">{l.sales_companies?.name ?? '—'}</div>
                        <div className="text-[11px] text-gray-500 truncate">
                          {[l.sales_companies?.sector, l.sales_companies?.city].filter(Boolean).join(' · ')}
                        </div>
                        {l.callback_at && (
                          <span className="mt-0.5 inline-flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1">
                            <Clock className="h-2.5 w-2.5" />{new Date(l.callback_at).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })}
                          </span>
                        )}
                      </td>
                      <td className="table-td">
                        <div className="truncate">{l.sales_contacts?.name ?? '—'}</div>
                        {l.sales_contacts?.email && <div className="text-[11px] text-gray-500 truncate">{l.sales_contacts.email}</div>}
                      </td>
                      <td className="table-td">
                        {phoneOf(l) ? (
                          <button onClick={(e) => { e.stopPropagation(); setQ(phoneOf(l)) }}
                            className="text-gray-700 hover:underline" title="Filter op dit nummer">{phoneOf(l)}</button>
                        ) : <span className="text-gray-400">—</span>}
                      </td>
                      <td className="table-td">
                        <span className={`status-badge ${STAGE_STYLE[l.stage_key] ?? 'bg-gray-100 text-gray-700'}`}>{stageLabel(l.stage_key)}</span>
                        {l.do_not_call && <span className="ml-1 status-badge bg-red-100 text-red-700">niet bellen</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detailpaneel */}
        <div>
          {selected
            ? <LeadDetail key={selected.id} lead={selected} pipelines={pipelines} onChanged={() => { load(); setSelected(null) }} onClose={() => setSelected(null)} />
            : <div className="card-base text-sm text-gray-500">Kies een lead om de details te zien.</div>}
        </div>
      </div>

      {focus && (
        <FocusMode
          leads={leads}
          pipelineId={pipelineId}
          onClose={() => { setFocus(false); load() }}
          onChanged={() => { /* lijst wordt bij sluiten ververst */ }}
        />
      )}

      {reminders && <ReminderSettings onClose={() => setReminders(false)} />}

      {importing && <ImportModal pipelineId={pipelineId} onClose={() => setImporting(false)} onDone={load} />}

      {newLead && <NewLeadModal pipelineId={pipelineId} onClose={() => setNewLead(false)} onCreated={() => { setNewLead(false); load() }} />}
    </div>
  )
}

// ── Detailpaneel ─────────────────────────────────────────────────────────────
function LeadDetail({ lead, pipelines, onChanged, onClose }: {
  lead: Lead; pipelines: Pipeline[]; onChanged: () => void; onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [callback, setCallback] = useState(lead.callback_at ? lead.callback_at.slice(0, 16) : '')
  const phone = lead.sales_contacts?.phone || lead.sales_contacts?.mobile || lead.sales_companies?.phone || ''

  const patch = async (body: Record<string, unknown>, okMsg?: string) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/sales/leads/${lead.id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      if (okMsg) toast.success(okMsg)
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBusy(false) }
  }

  return (
    <div className="card-base space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="font-semibold text-gray-900 truncate">{lead.sales_companies?.name}</h2>
          <p className="text-sm text-gray-600 truncate">
            {lead.sales_contacts?.name}{lead.sales_contacts?.role ? ` · ${lead.sales_contacts.role}` : ''}
          </p>
        </div>
        <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
      </div>

      {/* Voor welk merk bellen we deze lead? Verhuizen kan zolang er nog geen
          afspraak staat; blijkt aan de telefoon dat iemand beter bij het andere
          bedrijf past, dan zet je hem hier over. */}
      {pipelines.length > 1 && (
        <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50 w-full">
          {pipelines.map((p) => {
            const active = (lead.pipeline_id ?? pipelines[0]?.id) === p.id
            return (
              <button key={p.id} disabled={busy || active}
                onClick={() => patch({ pipelineId: p.id }, `Verhuisd naar ${p.name}.`)}
                className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  active ? 'bg-white text-black shadow-sm' : 'text-gray-500 hover:text-black disabled:opacity-50'}`}>
                {p.name}
              </button>
            )
          })}
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {phone && <a href={`tel:${phone}`} className="btn-secondary text-sm"><Phone className="h-4 w-4" />Bellen</a>}
        {lead.sales_contacts?.email && <a href={`mailto:${lead.sales_contacts.email}`} className="btn-secondary text-sm"><Mail className="h-4 w-4" />Mailen</a>}
        {/* De harde koppeling met de kalender (§6): lead vooringevuld meesturen. */}
        <Link href={`/admin/sales/appointments?lead=${lead.id}`} className="btn-primary text-sm">
          <CalendarClock className="h-4 w-4" />Afspraak
        </Link>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Status</label>
        <select className="input-base" value={lead.stage_key} disabled={busy}
          onChange={(e) => patch({ stage: e.target.value }, 'Status bijgewerkt.')}>
          {/* "Afspraak ingepland" staat bewust NIET in de lijst: die ontstaat
              alleen door een echte boeking (§3). Wel tonen als huidige waarde. */}
          {lead.stage_key === 'appointment' && <option value="appointment">{stageLabel('appointment')}</option>}
          {MANUAL_STAGES.map((s) => <option key={s} value={s}>{stageLabel(s)}</option>)}
        </select>
        {lead.stage_key === 'appointment' && (
          <p className="text-[11px] text-gray-500 mt-1">Deze status hoort bij een geboekte afspraak.</p>
        )}
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Terugbellen op</label>
        <div className="flex gap-2">
          <input type="datetime-local" className="input-base" value={callback} onChange={(e) => setCallback(e.target.value)} />
          <button onClick={() => patch({ callback_at: callback || null }, 'Ingepland.')} disabled={busy} className="btn-secondary text-sm">Zet</button>
        </div>
      </div>

      {lead.stage_key === 'email_todo' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Briefing voor de klant</label>
          <textarea rows={3} className="input-base" defaultValue={lead.email_brief ?? ''}
            onBlur={(e) => e.target.value !== (lead.email_brief ?? '') && patch({ email_brief: e.target.value })}
            placeholder="Wat is er besproken en wat moet er gemaild worden?" />
        </div>
      )}

      {lead.stage_key === 'lost' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Verliesreden</label>
          <input className="input-base" defaultValue={lead.lost_reason ?? ''}
            onBlur={(e) => e.target.value !== (lead.lost_reason ?? '') && patch({ lost_reason: e.target.value })} />
        </div>
      )}

      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1">Notitie toevoegen</label>
        <textarea rows={2} className="input-base" value={note} onChange={(e) => setNote(e.target.value)} />
        <button onClick={() => { if (note.trim()) { patch({ note }, 'Notitie opgeslagen.'); setNote('') } }}
          disabled={busy || !note.trim()} className="btn-secondary text-sm mt-2 w-full">Opslaan</button>
      </div>

      <div className="flex gap-2 pt-1 border-t border-gray-100">
        <button onClick={() => patch({ do_not_call: !lead.do_not_call }, lead.do_not_call ? 'Weer bellen.' : 'Gemarkeerd als niet bellen.')}
          disabled={busy} className="btn-secondary text-xs flex-1">
          <PhoneOff className="h-3.5 w-3.5" />{lead.do_not_call ? 'Weer bellen' : 'Niet bellen'}
        </button>
        <button onClick={() => patch({ archived: true }, 'Gearchiveerd.')} disabled={busy} className="btn-secondary text-xs flex-1">
          <Archive className="h-3.5 w-3.5" />Archiveer
        </button>
      </div>

      {lead.labels?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {lead.labels.map((l) => (
            <span key={l} className="text-[10px] bg-gray-100 text-gray-700 px-1.5 py-0.5 rounded flex items-center gap-1">
              <Tag className="h-2.5 w-2.5" />{l}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Nieuwe lead ──────────────────────────────────────────────────────────────
function NewLeadModal({ pipelineId, onClose, onCreated }: { pipelineId: string; onClose: () => void; onCreated: () => void }) {
  const [f, setF] = useState({ company: '', website: '', sector: '', city: '', companyPhone: '', contact: '', role: '', email: '', phone: '' })
  const [saving, setSaving] = useState(false)
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }))

  const save = async () => {
    if (!f.company.trim()) { toast.error('Bedrijfsnaam is verplicht'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/admin/sales/leads', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipelineId,
          company: { name: f.company, website: f.website, sector: f.sector, city: f.city, phone: f.companyPhone },
          contact: { name: f.contact, role: f.role, email: f.email, phone: f.phone },
        }),
      })
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      toast.success('Lead toegevoegd.')
      onCreated()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Toevoegen mislukt') } finally { setSaving(false) }
  }

  return (
    <Modal title="Nieuwe lead" onClose={onClose} onSave={save} saving={saving}>
      <Field label="Bedrijfsnaam *" value={f.company} onChange={(v) => set('company', v)} />
      <Field label="Website" value={f.website} onChange={(v) => set('website', v)} placeholder="bedrijf.be" />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Sector" value={f.sector} onChange={(v) => set('sector', v)} />
        <Field label="Stad" value={f.city} onChange={(v) => set('city', v)} />
      </div>
      <Field label="Telefoon bedrijf" value={f.companyPhone} onChange={(v) => set('companyPhone', v)} />
      <div className="pt-2 border-t border-gray-100" />
      <Field label="Contactpersoon" value={f.contact} onChange={(v) => set('contact', v)} />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Functie" value={f.role} onChange={(v) => set('role', v)} />
        <Field label="Telefoon" value={f.phone} onChange={(v) => set('phone', v)} />
      </div>
      <Field label="E-mail" value={f.email} onChange={(v) => set('email', v)} type="email" />
      <p className="text-[11px] text-gray-500">Bestaat dit bedrijf al in deze pipeline, dan melden we dat — er komt nooit een dubbele lead bij.</p>
    </Modal>
  )
}

// ── Kleine bouwstenen ────────────────────────────────────────────────────────
function Field({ label, value, onChange, type = 'text', placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} className="input-base" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  )
}

function Modal({ title, children, onClose, onSave, saving }: {
  title: string; children: React.ReactNode; onClose: () => void; onSave: () => void; saving: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>
        <div className="p-5 space-y-3 overflow-y-auto">{children}</div>
        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={onSave} disabled={saving} className="btn-primary flex-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}Opslaan
          </button>
          <button onClick={onClose} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </div>
  )
}
