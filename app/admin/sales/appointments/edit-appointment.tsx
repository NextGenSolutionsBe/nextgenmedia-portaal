'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, X, CalendarClock, Trash2, AlertTriangle, Save } from 'lucide-react'
import { OutcomePanel } from './outcome-panel'
import { LeadKiezer, type LeadOption } from './lead-kiezer'

type Appt = {
  id: string; starts_at: string; ends_at: string
  lead_id: string | null; company: string | null; contact: string | null
  pipeline_id?: string | null
  calendar_id?: string | null
  outcome?: 'won' | 'lost' | null
  deal_value_cents?: number | null
  commission_pct?: number | null
  tijdsbelasting?: number | null
  /** Briefing van de setter, ingetikt bij het boeken. */
  notes?: string | null
  client_note?: string | null
  titel?: string | null
  adres?: string | null
  meet_url?: string | null
  attendee_email?: string | null
}
type Pipeline = { id: string; key: string; name: string }
type Owner = { id: string; name: string; status: string; pipeline_id?: string | null }

/** Datum-tijd voor een <input type="datetime-local">, in lokale tijd. */
function forInput(iso: string | number): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * Een bestaande afspraak bewerken: lead, merk, agenda, tijd, titel, briefing,
 * afspraken met de prospect, adres, online link en genodigde.
 *
 * Verplaatsen kan BEWUST niet door te slepen. Een afspraak verzetten
 * verplaatst het agenda-item van Bram of Marco, laat de prospect een wijziging
 * zien en raakt de herinneringsmail — dat hoort niet per ongeluk te kunnen
 * gebeuren omdat je de muis liet slippen. Enkel wat je hier wijzigt wordt
 * meegestuurd.
 */
export function EditAppointment({ appt, pipelines, owners = [], isAdmin, onClose, onSaved }: {
  appt: Appt
  pipelines: Pipeline[]
  /** De gekoppelde agenda's (personen) — om de afspraak naar iemand anders te zetten. */
  owners?: Owner[]
  /** Enkel een admin legt gewonnen/verloren vast — daar hangt commissie aan. */
  isAdmin?: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [start, setStart] = useState(forInput(appt.starts_at))
  const [end, setEnd] = useState(forInput(appt.ends_at))
  // De afspraak draagt de bedrijfs- en contactnaam zelf al mee, dus de
  // gekoppelde lead is meteen toonbaar zonder hem eerst op te halen.
  const [lead, setLead] = useState<LeadOption | null>(
    appt.lead_id
      ? {
          id: appt.lead_id,
          label: [appt.company, appt.contact].filter(Boolean).join(' · ') || 'Lead',
          email: null,
          pipelineId: appt.pipeline_id ?? null,
        }
      : null,
  )
  const leadId = lead?.id ?? ''
  // Het merk kan hier ook nog wisselen — bv. wanneer tijdens het gesprek blijkt
  // dat de prospect beter bij het andere bedrijf past.
  const [pipelineId, setPipelineId] = useState(appt.pipeline_id ?? pipelines[0]?.id ?? '')
  const [ownerId, setOwnerId] = useState(appt.calendar_id ?? '')
  const [titel, setTitel] = useState(appt.titel ?? '')
  const [notes, setNotes] = useState(appt.notes ?? '')
  const [clientNote, setClientNote] = useState(appt.client_note ?? '')
  const [adres, setAdres] = useState(appt.adres ?? '')
  const [meetUrl, setMeetUrl] = useState(appt.meet_url ?? '')
  const [attendee, setAttendee] = useState(appt.attendee_email ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !saving) onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [onClose, saving])

  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  const tijdGewijzigd = start !== forInput(appt.starts_at) || end !== forInput(appt.ends_at)
  const agendaGewijzigd = !!ownerId && ownerId !== (appt.calendar_id ?? '')
  const tekstGewijzigd = (a: string, b: string | null | undefined) => a.trim() !== (b ?? '').trim()
  const detailsGewijzigd = tekstGewijzigd(titel, appt.titel) || tekstGewijzigd(notes, appt.notes)
    || tekstGewijzigd(clientNote, appt.client_note) || tekstGewijzigd(adres, appt.adres)
    || tekstGewijzigd(meetUrl, appt.meet_url) || tekstGewijzigd(attendee, appt.attendee_email)
  const leadGewijzigd = leadId !== (appt.lead_id ?? '')
  const changed = tijdGewijzigd || agendaGewijzigd || detailsGewijzigd || leadGewijzigd
    || pipelineId !== (appt.pipeline_id ?? '')
  const valid = Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs

  const leadPipeline = lead ? pipelines.find((p) => p.id === lead.pipelineId) ?? null : null
  // Agenda's die bij het gekozen merk passen (merkloos = beide), plus de huidige.
  const kiesbareAgendas = owners.filter((o) => o.id === appt.calendar_id || !o.pipeline_id || o.pipeline_id === pipelineId)
  const nieuweAgendaNaam = owners.find((o) => o.id === ownerId)?.name ?? null

  const save = async () => {
    if (!valid) { toast.error('Het einduur moet ná het beginuur liggen'); return }
    if (meetUrl.trim() && !/^https?:\/\/\S+$/i.test(meetUrl.trim())) { toast.error('De online link moet met https:// beginnen.'); return }
    if (attendee.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(attendee.trim())) { toast.error('Het e-mailadres van de genodigde klopt niet.'); return }
    if (agendaGewijzigd && !confirm(`De afspraak naar de agenda van ${nieuweAgendaNaam ?? 'een andere persoon'} zetten?\n\nHet agenda-item verhuist: de prospect krijgt een annulering van het oude en een nieuwe uitnodiging.`)) return
    const body: Record<string, unknown> = {
      id: appt.id, startsAt: startMs, endsAt: endMs,
      leadId: leadId || null, pipelineId: pipelineId || null,
    }
    if (agendaGewijzigd) body.ownerId = ownerId
    if (tekstGewijzigd(titel, appt.titel)) body.titel = titel.trim()
    if (tekstGewijzigd(notes, appt.notes)) body.notes = notes.trim()
    if (tekstGewijzigd(clientNote, appt.client_note)) body.clientNote = clientNote.trim()
    if (tekstGewijzigd(adres, appt.adres)) body.adres = adres.trim()
    if (tekstGewijzigd(meetUrl, appt.meet_url)) body.meetUrl = meetUrl.trim()
    if (tekstGewijzigd(attendee, appt.attendee_email)) body.attendeeEmail = attendee.trim()
    setSaving(true)
    try {
      const r = await fetch('/api/admin/sales/appointments', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? 'Opslaan mislukt')
      toast.success(tijdGewijzigd || agendaGewijzigd ? 'Afspraak verzet.' : 'Afspraak bijgewerkt.')
      // Was de herinnering al vertrokken, dan moet je dat weten — vandaar een
      // aparte, blijvende melding in plaats van een vluchtige toast.
      if (j.reminderNote) toast.warning(j.reminderNote, { duration: 12000 })
      if (j.waarschuwing) toast.warning(j.waarschuwing, { duration: 12000 })
      onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setSaving(false) }
  }

  const cancel = async () => {
    if (!confirm('Deze afspraak annuleren?\n\nHet agenda-item wordt verwijderd en de herinneringsmail gaat niet uit.')) return
    setSaving(true)
    try {
      const r = await fetch(`/api/admin/sales/appointments?id=${appt.id}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error ?? 'Annuleren mislukt')
      toast.success('Afspraak geannuleerd.')
      if (j.waarschuwing) toast.warning(j.waarschuwing, { duration: 12000 })
      onSaved()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Annuleren mislukt') } finally { setSaving(false) }
  }

  const label = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-xl w-full sm:max-w-lg max-h-[92dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between gap-2 p-5 border-b border-gray-100">
          <div className="min-w-0">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-gray-400" />Afspraak bewerken
            </h3>
            <p className="text-sm text-gray-600 mt-0.5 truncate">
              {appt.company ?? 'Afspraak zonder lead'}{appt.contact ? ` · ${appt.contact}` : ''}
            </p>
          </div>
          <button onClick={onClose} aria-label="Sluiten" className="h-7 w-7 shrink-0 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div>
            <label className={label}>Lead</label>
            <LeadKiezer waarde={lead} onKies={setLead} />
            {leadGewijzigd && !tekstGewijzigd(attendee, appt.attendee_email) && (
              <p className="text-[11px] text-gray-500 mt-1">De genodigde wordt het e-mailadres van de nieuwe lead (als die er een heeft).</p>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={label}>Afspraak voor</label>
              <select className="input-base" value={pipelineId} onChange={(e) => setPipelineId(e.target.value)}>
                {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            {owners.length > 0 && (
              <div>
                <label className={label}>Agenda</label>
                <select className="input-base" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                  {!appt.calendar_id && <option value="">Geen agenda</option>}
                  {kiesbareAgendas.map((o) => (
                    <option key={o.id} value={o.id} disabled={o.status !== 'connected' && o.id !== appt.calendar_id}>
                      {o.name}{o.status !== 'connected' ? ' (niet verbonden)' : ''}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <p className="text-[11px] text-gray-500 -mt-1">
            Het merk bepaalt welke one-pager en welke afzender bij de herinneringsmail horen.
            {leadPipeline && pipelineId !== leadPipeline.id && (
              <> De lead blijft in <b>{leadPipeline.name}</b> staan; enkel deze afspraak telt voor het gekozen merk.</>
            )}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={label}>Begint om</label>
              <input type="datetime-local" className="input-base" value={start} onChange={(e) => setStart(e.target.value)} />
            </div>
            <div>
              <label className={label}>Eindigt om</label>
              <input type="datetime-local" className="input-base" value={end} onChange={(e) => setEnd(e.target.value)} />
            </div>
          </div>

          {!valid && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              Het einduur moet ná het beginuur liggen.
            </p>
          )}

          <div>
            <label className={label}>Titel in de agenda</label>
            <input className="input-base" value={titel} maxLength={120} placeholder="Leeg = “Bedrijf — Merk”"
              onChange={(e) => setTitel(e.target.value)} />
            <p className="text-[11px] text-gray-500 mt-1">De prospect ziet deze titel in zijn uitnodiging.</p>
          </div>

          <div>
            <label className={label}>Briefing van de setter</label>
            <textarea rows={3} className="input-base" value={notes} maxLength={4000} placeholder="Wat er aan de telefoon gezegd is (intern)"
              onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div>
            <label className={label}>Afgesproken met de prospect</label>
            <textarea rows={2} className="input-base" value={clientNote} maxLength={2000} placeholder="Staat ook in de uitnodiging"
              onChange={(e) => setClientNote(e.target.value)} />
          </div>

          <div>
            <label className={label}>Adres</label>
            <input className="input-base" value={adres} maxLength={300} placeholder="Straat nr, gemeente" onChange={(e) => setAdres(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <label className={label}>Online link (Meet)</label>
              <input type="url" className="input-base" value={meetUrl} maxLength={500} placeholder="https://meet.google.com/…"
                onChange={(e) => setMeetUrl(e.target.value)} />
            </div>
            <div>
              <label className={label}>Genodigde (e-mail)</label>
              <input type="email" className="input-base" value={attendee} maxLength={200} placeholder="prospect@bedrijf.be"
                onChange={(e) => setAttendee(e.target.value)} />
            </div>
          </div>

          {changed && valid && (
            <p className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                {agendaGewijzigd
                  ? <>Het agenda-item verhuist naar de agenda van <b>{nieuweAgendaNaam}</b>; de prospect krijgt een annulering en een nieuwe uitnodiging.</>
                  : tijdGewijzigd
                    ? <>Bij opslaan verplaatsen we ook het agenda-item, en de prospect krijgt een gewijzigde uitnodiging. Staat de herinneringsmail nog klaar, dan wordt die op het nieuwe uur gezet.</>
                    : <>Het agenda-item en de ClickUp-taak worden mee bijgewerkt. Staat er een genodigde op, dan krijgt die de wijziging te zien.</>}
              </span>
            </p>
          )}

          {isAdmin && (
            <OutcomePanel
              appointmentId={appt.id}
              outcome={appt.outcome ?? null}
              dealValueCents={appt.deal_value_cents}
              commissionPct={appt.commission_pct}
              tijdsbelasting={appt.tijdsbelasting}
              onDone={onSaved}
            />
          )}

          {(tijdGewijzigd || agendaGewijzigd) && (
            <p className="text-[11px] text-gray-500">
              Het nieuwe tijdvak wordt opnieuw gecontroleerd: valt het buiten de vrije (witte) uren of botst
              het met iets anders, dan wordt er niets gewijzigd.
            </p>
          )}
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={save} disabled={saving || !valid || !changed} className="btn-primary flex-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : tijdGewijzigd || agendaGewijzigd ? <CalendarClock className="h-4 w-4" /> : <Save className="h-4 w-4" />}
            {!changed ? 'Niets gewijzigd' : tijdGewijzigd || agendaGewijzigd ? 'Verzetten bevestigen' : 'Wijzigingen opslaan'}
          </button>
          <button onClick={cancel} disabled={saving} className="btn-danger" title="Afspraak annuleren">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
