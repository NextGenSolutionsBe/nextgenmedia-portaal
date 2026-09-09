'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, RefreshCw, Clock, CheckCircle2, AlertTriangle, MailX, Send, Inbox, Ban, CalendarClock, X,
  Trash2, Undo2,
} from 'lucide-react'

type Item = {
  appointmentId: string
  company: string | null
  contact: string | null
  email: string | null
  pipeline: string | null
  owner: string | null
  startsAt: string
  dueAt: string
  state: 'sent' | 'scheduled' | 'pending' | 'blocked' | 'cancelled'
  reason: string | null
  resendEvent: string | null
}

/** Resend-gebeurtenis → wat het voor jou betekent. */
const EVENT: Record<string, { label: string; tone: string; good: boolean }> = {
  delivered:        { label: 'Aangekomen',        tone: 'bg-green-100 text-green-800', good: true },
  sent:             { label: 'Verstuurd',         tone: 'bg-green-50 text-green-700', good: true },
  opened:           { label: 'Geopend',           tone: 'bg-green-100 text-green-800', good: true },
  clicked:          { label: 'Link aangeklikt',   tone: 'bg-green-100 text-green-800', good: true },
  queued:           { label: 'In de wachtrij',    tone: 'bg-gray-100 text-gray-700', good: true },
  scheduled:        { label: 'Staat klaar',       tone: 'bg-blue-50 text-blue-700', good: true },
  delivery_delayed: { label: 'Vertraagd',         tone: 'bg-amber-100 text-amber-800', good: false },
  bounced:          { label: 'Niet aangekomen',   tone: 'bg-red-100 text-red-700', good: false },
  complained:       { label: 'Als spam gemeld',   tone: 'bg-red-100 text-red-700', good: false },
  canceled:         { label: 'Geannuleerd',       tone: 'bg-gray-200 text-gray-700', good: false },
  failed:           { label: 'Mislukt',           tone: 'bg-red-100 text-red-700', good: false },
}

const dt = (iso: string) =>
  new Date(iso).toLocaleString('nl-BE', {
    weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

/** "over 3 uur" / "2 dagen geleden" — sneller te lezen dan een datum. */
function relative(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now()
  const abs = Math.abs(diff)
  const mins = Math.round(abs / 60000)
  const val = mins < 60 ? `${mins} min`
    : abs < 86400000 ? `${Math.round(mins / 60)} uur`
    : `${Math.round(abs / 86400000)} dag${Math.round(abs / 86400000) === 1 ? '' : 'en'}`
  return diff >= 0 ? `over ${val}` : `${val} geleden`
}

export function MailOverview() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  // Opgeschoonde regels staan standaard niet in beeld, maar zijn op te vragen.
  const [showHidden, setShowHidden] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)

  const load = useCallback(async (quiet = false) => {
    if (quiet) setRefreshing(true)
    try {
      const r = await fetch(`/api/admin/sales/reminders${showHidden ? '?hidden=1' : ''}`, { cache: 'no-store' })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      setItems(j.items ?? [])
      setHint(j.hint ?? null)
      // Selectie leegmaken: id's uit de vorige lijst slaan nergens meer op.
      setPicked(new Set())
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
    finally { setLoading(false); setRefreshing(false) }
  }, [showHidden])
  useEffect(() => { load() }, [load])

  /** Actie op de hele selectie. */
  const bulk = async (action: 'hide' | 'unhide' | 'cancel') => {
    if (picked.size === 0) return
    if (action === 'cancel' && !confirm(
      `${picked.size} mail(s) tegenhouden?

Die prospects krijgen dan geen herinnering.`,
    )) return
    if (action === 'hide' && !confirm(
      `${picked.size} regel(s) opschonen?

De afspraken blijven gewoon staan; enkel deze regels ` +
      'verdwijnen uit de lijst. Je haalt ze terug met "Toon opgeschoonde".',
    )) return

    setBulkBusy(true)
    try {
      const r = await fetch('/api/admin/sales/reminders/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, appointmentIds: [...picked] }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(j.message ?? 'Klaar.')
      await load(true)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBulkBusy(false) }
  }

  const toggle = (id: string) => setPicked((p) => {
    const n = new Set(p)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  if (loading) {
    return <div className="card-base py-12 text-center text-gray-400"><Loader2 className="h-5 w-5 animate-spin mx-auto" /></div>
  }

  const open = items.filter((i) => i.state === 'scheduled' || i.state === 'pending')
  const blocked = items.filter((i) => i.state === 'blocked' || i.state === 'cancelled')
  const sent = items.filter((i) => i.state === 'sent')
  const failed = sent.filter((i) => i.resendEvent && EVENT[i.resendEvent]?.good === false)

  return (
    <div className="space-y-4">
      {hint && (
        <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {hint}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Stat n={open.length} label="staan klaar" tone="text-blue-700" />
        <Stat n={sent.length - failed.length} label="verstuurd" tone="text-green-700" />
        {failed.length > 0 && <Stat n={failed.length} label="niet aangekomen" tone="text-red-700" />}
        {blocked.length > 0 && <Stat n={blocked.length} label="gaan niet uit" tone="text-amber-700" />}
        <label className="text-xs text-gray-600 flex items-center gap-1.5 cursor-pointer ml-auto">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          Toon opgeschoonde
        </label>
        <button onClick={() => load(true)} disabled={refreshing} className="btn-secondary text-sm">
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}Ververs
        </button>
      </div>

      {/* Balk met bulk-acties; verschijnt enkel als er iets aangevinkt is. */}
      {picked.size > 0 && (
        <div className="flex items-center gap-2 flex-wrap rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
          <span className="text-sm font-medium">{picked.size} geselecteerd</span>
          {showHidden ? (
            <button onClick={() => bulk('unhide')} disabled={bulkBusy} className="btn-secondary text-sm">
              <Undo2 className="h-3.5 w-3.5" />Terughalen
            </button>
          ) : (
            <>
              <button onClick={() => bulk('cancel')} disabled={bulkBusy} className="btn-secondary text-sm">
                <Ban className="h-3.5 w-3.5" />Tegenhouden
              </button>
              <button onClick={() => bulk('hide')} disabled={bulkBusy} className="btn-danger text-sm">
                <Trash2 className="h-3.5 w-3.5" />Opschonen
              </button>
            </>
          )}
          <button onClick={() => setPicked(new Set())} className="text-xs text-gray-500 hover:text-black ml-auto">
            Selectie wissen
          </button>
          {bulkBusy && <Loader2 className="h-4 w-4 animate-spin text-gray-400" />}
        </div>
      )}

      <Section
        title="Gaat nog uit"
        icon={Clock}
        empty="Er staat op dit moment niets klaar."
        rows={open}
        showDue
        picked={picked} onToggle={toggle} onPickAll={setPicked}
        onChanged={() => load(true)}
      />

      {blocked.length > 0 && (
        <Section
          title="Hier gaat niets uit"
          icon={MailX}
          empty=""
          rows={blocked}
          showDue={false}
          picked={picked} onToggle={toggle} onPickAll={setPicked}
          onChanged={() => load(true)}
        />
      )}

      <Section
        title="Verstuurd"
        icon={Send}
        empty="Nog niets verstuurd."
        rows={sent}
        showDue
        past
        picked={picked} onToggle={toggle} onPickAll={setPicked}
      />

      <p className="text-[11px] text-gray-500">
        Opschonen haalt regels enkel uit deze lijst — de afspraken zelf blijven staan. Een mail die nog moet
        vertrekken kan niet opgeschoond worden; houd hem eerst tegen, anders zou hij uit beeld verdwijnen
        terwijl hij gewoon nog uitgaat.
      </p>
    </div>
  )
}

function Stat({ n, label, tone }: { n: number; label: string; tone: string }) {
  return (
    <div className="rounded-xl border border-gray-200/80 bg-white px-3 py-1.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <span className={`font-bold ${tone}`}>{n}</span>
      <span className="text-sm text-gray-600 ml-1.5">{label}</span>
    </div>
  )
}

function Section({ title, icon: Icon, empty, rows, showDue, past, picked, onToggle, onPickAll, onChanged }: {
  title: string
  icon: typeof Clock
  empty: string
  rows: Item[]
  showDue: boolean
  past?: boolean
  picked: Set<string>
  onToggle: (id: string) => void
  onPickAll: (next: Set<string>) => void
  onChanged?: () => void
}) {
  const ids = rows.map((r) => r.appointmentId)
  const allPicked = ids.length > 0 && ids.every((id) => picked.has(id))
  /** Alles in DEZE sectie aan- of uitvinken, zonder de rest te verliezen. */
  const toggleAll = () => {
    const next = new Set(picked)
    if (allPicked) ids.forEach((id) => next.delete(id))
    else ids.forEach((id) => next.add(id))
    onPickAll(next)
  }
  if (rows.length === 0 && !empty) return null
  return (
    <div className="card-base p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
        <Icon className="h-4 w-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        <span className="text-xs text-gray-400">({rows.length})</span>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state text-sm flex flex-col items-center gap-2">
          <Inbox className="h-6 w-6 opacity-30" />{empty}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="table-th w-8">
                  <input type="checkbox" aria-label="Alles in deze lijst selecteren"
                    checked={allPicked} onChange={toggleAll} />
                </th>
                <th className="table-th">Bedrijf</th>
                <th className="table-th">Merk</th>
                <th className="table-th">Naar</th>
                <th className="table-th">{past ? 'Verstuurd' : 'Vertrekt'}</th>
                <th className="table-th">Afspraak</th>
                <th className="table-th">Status</th>
                {onChanged && <th className="table-th text-right">Actie</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((i) => (
                <tr key={i.appointmentId}
                  className={`hover:bg-gray-50 ${picked.has(i.appointmentId) ? 'bg-[#fff848]/10' : ''}`}>
                  <td className="table-td">
                    <input type="checkbox" aria-label="Selecteer deze regel"
                      checked={picked.has(i.appointmentId)} onChange={() => onToggle(i.appointmentId)} />
                  </td>
                  <td className="table-td">
                    <div className="font-medium truncate">{i.company ?? 'Afspraak zonder lead'}</div>
                    {i.contact && <div className="text-[11px] text-gray-500 truncate">{i.contact}</div>}
                  </td>
                  <td className="table-td">
                    {i.pipeline
                      ? <span className="status-badge bg-gray-100 text-gray-700">{i.pipeline}</span>
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="table-td">
                    {i.email
                      ? <span className="text-gray-700">{i.email}</span>
                      : <span className="text-gray-400">geen adres</span>}
                  </td>
                  <td className="table-td whitespace-nowrap">
                    {showDue ? (
                      <>
                        <div className="tabular">{dt(i.dueAt)}</div>
                        <div className="text-[11px] text-gray-500">{relative(i.dueAt)}</div>
                      </>
                    ) : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="table-td whitespace-nowrap">
                    <div className="tabular text-gray-700">{dt(i.startsAt)}</div>
                    {i.owner && <div className="text-[11px] text-gray-500">agenda {i.owner}</div>}
                  </td>
                  <td className="table-td">
                    <StatusCell item={i} />
                  </td>
                  {onChanged && (
                    <td className="table-td text-right">
                      <RowActions item={i} onChanged={onChanged} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function StatusCell({ item }: { item: Item }) {
  if (item.resendEvent) {
    const e = EVENT[item.resendEvent] ?? { label: item.resendEvent, tone: 'bg-gray-100 text-gray-700', good: true }
    return (
      <span className={`status-badge ${e.tone} flex items-center gap-1 w-fit`}>
        {e.good ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}{e.label}
      </span>
    )
  }
  if (item.state === 'cancelled') {
    return (
      <div className="max-w-[16rem]">
        <span className="status-badge bg-gray-200 text-gray-700 flex items-center gap-1 w-fit">
          <Ban className="h-3 w-3" />Tegengehouden
        </span>
        <div className="text-[11px] text-gray-500 mt-0.5">Gaat niet uit; handmatig gestopt.</div>
      </div>
    )
  }
  if (item.state === 'blocked') {
    return (
      <div className="max-w-[16rem]">
        <span className="status-badge bg-amber-100 text-amber-800 flex items-center gap-1 w-fit">
          <AlertTriangle className="h-3 w-3" />Gaat niet uit
        </span>
        {item.reason && <div className="text-[11px] text-gray-500 mt-0.5">{item.reason}</div>}
      </div>
    )
  }
  if (item.state === 'scheduled') {
    return <span className="status-badge bg-blue-50 text-blue-700 flex items-center gap-1 w-fit"><CheckCircle2 className="h-3 w-3" />Staat klaar</span>
  }
  if (item.state === 'pending') {
    // Ligt het verzendmoment nog ver weg, dan is wachten normaal. Ligt het
    // dichtbij en staat er nog niets klaar, dan is er iets mis — dan mag daar
    // geen geruststellende tekst bij staan.
    const soon = new Date(item.dueAt).getTime() - Date.now() < 72 * 3600 * 1000
    return (
      <div className="max-w-[16rem]">
        <span className={`status-badge w-fit ${soon ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>
          {soon ? 'Staat nog niet klaar' : 'Wordt later ingepland'}
        </span>
        <div className="text-[11px] text-gray-500 mt-0.5">
          {soon
            ? 'Zou intussen ingepland moeten zijn. Gebruik “Nu” of “Verzetten”.'
            : 'Verder dan 3 dagen vooruit; gebeurt automatisch.'}
        </div>
      </div>
    )
  }
  return <span className="status-badge bg-green-50 text-green-700">Verstuurd</span>
}

// ── Handmatig ingrijpen ──────────────────────────────────────────────────────

/** Datum-tijd voor een <input type="datetime-local">, in lokale tijd. */
function forInput(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function RowActions({ item, onChanged }: { item: Item; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [when, setWhen] = useState<string | null>(null)

  // Een tegengehouden mail of een geblokkeerde rij zonder adres valt niets meer
  // mee te doen; dan tonen we ook geen knoppen die toch zouden falen.
  const canAct = item.state === 'scheduled' || item.state === 'pending'
  if (!canAct) return <span className="text-gray-300 text-xs">—</span>

  const act = async (action: string, at?: string) => {
    if (action === 'cancel' && !confirm(
      `Deze mail tegenhouden?

${item.company ?? 'Deze prospect'} krijgt dan geen herinnering. ` +
      'Dat kan later niet ongedaan gemaakt worden zonder hem opnieuw in te plannen.',
    )) return
    setBusy(true)
    try {
      const r = await fetch('/api/admin/sales/reminders/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appointmentId: item.appointmentId, action, at }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      toast.success(j.message ?? 'Aangepast.')
      setWhen(null)
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') } finally { setBusy(false) }
  }

  if (when !== null) {
    return (
      <div className="flex items-center gap-1 justify-end">
        <input type="datetime-local" className="input-base w-auto text-xs py-1"
          value={when} onChange={(e) => setWhen(e.target.value)} />
        <button onClick={() => act('reschedule', new Date(when).toISOString())} disabled={busy || !when}
          className="btn-primary text-xs px-2 py-1">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Zet'}
        </button>
        <button onClick={() => setWhen(null)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-gray-100 text-gray-400">
          <X className="h-3 w-3" />
        </button>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1 justify-end">
      <button onClick={() => act('send_now')} disabled={busy} title="Nu meteen versturen"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
        {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}Nu
      </button>
      <button onClick={() => setWhen(forInput(item.dueAt))} disabled={busy} title="Op een ander moment zetten"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-gray-200 hover:bg-gray-50 disabled:opacity-50">
        <CalendarClock className="h-3 w-3" />Verzetten
      </button>
      <button onClick={() => act('cancel')} disabled={busy} title="Deze mail niet versturen"
        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50">
        <Ban className="h-3 w-3" />
      </button>
    </div>
  )
}
