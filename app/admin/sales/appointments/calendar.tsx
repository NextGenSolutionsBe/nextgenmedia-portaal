'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Loader2, ChevronLeft, ChevronRight, Link2, CalendarClock, X, Trash2, Video, Settings2, CalendarRange, UserRound } from 'lucide-react'
import { complement, snapToSlot, type Interval } from '@/lib/sales/availability'
import { AvailabilityPanel } from './availability-panel'
import { BusyCalendarsPanel } from './busy-calendars'
import { AgendaDialog } from './agenda-dialog'
import { EditAppointment } from './edit-appointment'
import { LeadKiezer, type LeadOption } from './lead-kiezer'

type SalesClient = {
  id: string; name: string; timezone: string
  slot_interval_min: number; default_duration_min: number
}
type Appt = {
  id: string; starts_at: string; ends_at: string; status: string
  lead_id: string | null; company: string | null; contact: string | null
  pipeline_id?: string | null
  outcome?: 'won' | 'lost' | null
  deal_value_cents?: number | null
  commission_pct?: number | null
}
type Pipeline = { id: string; name: string }

// Zichtbaar dagvenster. Buiten deze uren is toch alles grijs; dit houdt de
// kalender compact zonder dat je 24 uur moet scrollen.
const DAY_START_H = 7
const DAY_END_H = 21
const PX_PER_MIN = 0.9

const startOfWeek = (d: Date): Date => {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  const dow = (x.getDay() + 6) % 7      // 0 = maandag
  x.setDate(x.getDate() - dow)
  return x
}
const hhmm = (ms: number) =>
  new Date(ms).toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit' })

/** Eén algemene pipeline; de keuze die telt is WIENS agenda je bekijkt. */
export function SalesCalendar({ client, pipelines, isAdmin, initialLeadId }: {
  client: SalesClient
  pipelines: Pipeline[]
  isAdmin?: boolean
  initialLeadId?: string
}) {
  const clientId = client.id
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [loading, setLoading] = useState(true)
  const [segments, setSegments] = useState<Interval[]>([])
  const [appointments, setAppointments] = useState<Appt[]>([])
  const [connected, setConnected] = useState(false)
  // Agenda's (personen) van deze klant — Bram, Marco, …
  const [owners, setOwners] = useState<{
    id: string; name: string; account_email: string | null; status: string
    signature_image_url?: string | null
  }[]>([])
  const [ownerId, setOwnerId] = useState<string>('')

  // Sleep-selectie
  const [drag, setDrag] = useState<{ segIdx: number; start: number; end: number } | null>(null)
  const dragRef = useRef<{ seg: Interval; anchor: number } | null>(null)
  const [booking, setBooking] = useState<{ start: number; end: number } | null>(null)
  const [showAvailability, setShowAvailability] = useState(false)
  const [showCalendars, setShowCalendars] = useState(false)
  // null = dicht, 'new' = koppelen, anders de agenda die bewerkt wordt.
  const [agendaDialog, setAgendaDialog] = useState<'new' | string | null>(null)

  // Bestaande afspraak bewerken. Verplaatsen kan BEWUST niet door te slepen:
  // dat verzet het agenda-item van Bram of Marco, stuurt de prospect een
  // gewijzigde uitnodiging en raakt de herinneringsmail. Zoiets hoort niet te
  // gebeuren omdat je de muis liet slippen — dus klikken, aanpassen, bevestigen.
  const [editing, setEditing] = useState<Appt | null>(null)

  const from = weekStart.getTime()
  const to = from + 7 * 86400000

  const load = useCallback(async () => {
    if (!clientId) return
    setLoading(true)
    try {
      const p = new URLSearchParams({ from: String(from), to: String(to) })
      if (ownerId) p.set('owner', ownerId)
      const res = await fetch(`/api/admin/sales/calendar?${p}`)
      const j = await res.json()
      if (!res.ok) throw new Error(j.error)
      setSegments(j.segments ?? [])
      setAppointments(j.appointments ?? [])
      setConnected(!!j.connected)
      setOwners(j.owners ?? [])
      // De server bepaalt welke agenda getoond wordt als er nog geen keuze is.
      if (j.ownerId && j.ownerId !== ownerId) setOwnerId(j.ownerId)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Agenda laden mislukt') } finally { setLoading(false) }
  }, [from, to, ownerId])
  useEffect(() => { load() }, [load])

  // De leadkiezer haalt zijn eigen treffers op terwijl je typt — zie
  // LeadKiezer hieronder. Vroeger stond hier een fetch van álle leads
  // (2711 stuks, 2,7 MB) waarvan het paneel enkel naam en e-mail gebruikte.

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => new Date(from + i * 86400000)), [from])

  // Grijs = het COMPLEMENT van wit. Dezelfde bron, dus beeld en gedrag kunnen
  // niet uiteenlopen: waar geen wit segment ligt, kun je ook niet slepen.
  const greyByDay = useMemo(() => days.map((d) => {
    const s = d.getTime(), e = s + 86400000
    return complement(segments.filter((x) => x.end > s && x.start < e), s, e)
  }), [days, segments])

  const dayTop = (d: Date) => new Date(d).setHours(DAY_START_H, 0, 0, 0)
  const yOf = (ms: number, d: Date) => ((ms - dayTop(d)) / 60000) * PX_PER_MIN
  const gridHeight = (DAY_END_H - DAY_START_H) * 60 * PX_PER_MIN

  // ── Slepen: begint ALTIJD op een wit segment ───────────────────────────────
  const onSegmentDown = (e: React.MouseEvent, seg: Interval, day: Date, idx: number) => {
    e.preventDefault()
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const slot = client?.slot_interval_min ?? 30
    const msAt = (clientY: number) => {
      const min = (clientY - rect.top) / PX_PER_MIN
      return seg.start + min * 60000
    }
    const anchor = Math.min(Math.max(snapToSlot(msAt(e.clientY), slot), seg.start), seg.end)
    dragRef.current = { seg, anchor }
    const dur = (client?.default_duration_min ?? 30) * 60000
    setDrag({ segIdx: idx, start: anchor, end: Math.min(anchor + dur, seg.end) })
  }

  useEffect(() => {
    if (!drag) return
    const slot = client?.slot_interval_min ?? 30
    const onMove = (ev: MouseEvent) => {
      const d = dragRef.current
      if (!d) return
      const el = document.querySelector<HTMLElement>(`[data-seg="${drag.segIdx}"]`)
      if (!el) return
      const rect = el.getBoundingClientRect()
      const min = (ev.clientY - rect.top) / PX_PER_MIN
      let cursor = snapToSlot(d.seg.start + min * 60000, slot, 'ceil')
      // Klemmen binnen het witte segment: buiten wit bestaat er geen boeking.
      cursor = Math.min(Math.max(cursor, d.seg.start), d.seg.end)
      const start = Math.min(d.anchor, cursor)
      const end = Math.max(d.anchor, cursor)
      setDrag((cur) => cur && ({ ...cur, start, end: Math.max(end, start + slot * 60000) }))
    }
    const onUp = () => {
      const cur = dragRef.current
      dragRef.current = null
      setDrag((d) => {
        if (d && cur && d.end > d.start) setBooking({ start: d.start, end: Math.min(d.end, cur.seg.end) })
        return null
      })
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp) }
  }, [drag, client])

  return (
    <div className="space-y-4">
      {/* Kop: wiens agenda, week, koppeling */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {/* De belangrijkste keuze op dit scherm: voor wie boek je? */}
          {owners.length > 0 && (
            <label className="flex items-center gap-1.5 text-sm text-gray-600">
              Agenda van
              <select className="input-base w-auto" value={ownerId} onChange={(e) => setOwnerId(e.target.value)}
                title="Voor wie boek je?">
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name || o.account_email || 'Agenda'}</option>)}
              </select>
            </label>
          )}
          <div className="flex items-center gap-1">
            <button onClick={() => setWeekStart(new Date(from - 7 * 86400000))} className="btn-secondary px-2" aria-label="Vorige week"><ChevronLeft className="h-4 w-4" /></button>
            <button onClick={() => setWeekStart(startOfWeek(new Date()))} className="btn-secondary text-sm">Deze week</button>
            <button onClick={() => setWeekStart(new Date(from + 7 * 86400000))} className="btn-secondary px-2" aria-label="Volgende week"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <span className="text-sm text-gray-600">
            {days[0].toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })} – {days[6].toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {ownerId && (
            <button onClick={() => setAgendaDialog(ownerId)} className="btn-secondary text-sm"
              title="Naam en e-mailhandtekening van deze agenda">
              <UserRound className="h-4 w-4" />Handtekening
            </button>
          )}
          {ownerId && (
            <button onClick={() => setShowCalendars(true)} className="btn-secondary text-sm"
              title="Welke agenda's van dit Google-account blokkeren de beschikbaarheid">
              <CalendarRange className="h-4 w-4" />Agenda&apos;s
            </button>
          )}
          <button onClick={() => setShowAvailability(true)} className="btn-secondary text-sm" title="Werkuren, buffers en boekingsregels">
            <Settings2 className="h-4 w-4" />Beschikbaarheid
          </button>
          {connected && (
            <span className="status-badge bg-green-100 text-green-700 flex items-center gap-1"><Link2 className="h-3 w-3" />Gekoppeld</span>
          )}
          {/* Meerdere agenda's: elke persoon koppelt zijn eigen Google-account. */}
          <button
            onClick={() => setAgendaDialog('new')}
            className={owners.length === 0 ? 'btn-primary text-sm' : 'btn-secondary text-sm'}>
            <Link2 className="h-4 w-4" />{owners.length === 0 ? 'Google Agenda koppelen' : 'Agenda toevoegen'}
          </button>
        </div>
      </div>

      {owners.length === 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          Nog geen agenda gekoppeld. Zonder agenda zien we geen bezette momenten en kan er niet geboekt worden.
          Koppel per persoon (Bram, Marco, ...) een eigen Google-agenda.
        </p>
      )}

      {/* De koppeling kan van Google's kant vervallen. Dat mag nooit stil
          gebeuren: zonder waarschuwing lijkt de agenda gewoon helemaal vrij. */}
      {owners.length > 0 && !connected && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          De koppeling met deze agenda werkt niet meer — we zien de bezette momenten van Google niet.
          Wat hier wit staat, klopt dus mogelijk niet. Klik op <b>Agenda toevoegen</b> en koppel dezelfde
          persoon opnieuw.
        </p>
      )}

      {/* Kalender */}
      <div className="card-base p-0 overflow-hidden">
        <div className="grid grid-cols-[52px_repeat(7,1fr)] border-b border-gray-100">
          <div />
          {days.map((d, i) => (
            <div key={i} className="px-2 py-2 text-center border-l border-gray-100">
              <div className="text-[11px] text-gray-500 uppercase">{d.toLocaleDateString('nl-BE', { weekday: 'short' })}</div>
              <div className="text-sm font-semibold">{d.getDate()}</div>
            </div>
          ))}
        </div>

        <div className="relative overflow-x-auto">
          <div className="grid grid-cols-[52px_repeat(7,1fr)]" style={{ height: gridHeight }}>
            {/* Uren links */}
            <div className="relative">
              {Array.from({ length: DAY_END_H - DAY_START_H }, (_, i) => (
                <div key={i} className="absolute right-1 text-[10px] text-gray-400" style={{ top: i * 60 * PX_PER_MIN - 5 }}>
                  {String(DAY_START_H + i).padStart(2, '0')}:00
                </div>
              ))}
            </div>

            {days.map((day, di) => (
              <div key={di} data-daycol={day.getTime()} className="relative border-l border-gray-100 bg-gray-100">
                {/* Grijs: alles wat niet boekbaar is, als één samensmeltend geheel */}
                {greyByDay[di].map((g, gi) => {
                  const top = Math.max(0, yOf(g.start, day))
                  const bottom = Math.min(gridHeight, yOf(g.end, day))
                  if (bottom <= 0 || top >= gridHeight) return null
                  return <div key={gi} className="absolute inset-x-0 bg-gray-100" style={{ top, height: bottom - top }} />
                })}

                {/* Wit: enkel hierop kun je slepen */}
                {segments.map((seg, si) => {
                  const dayS = day.getTime(), dayE = dayS + 86400000
                  if (seg.end <= dayS || seg.start >= dayE) return null
                  const s = Math.max(seg.start, dayS), e = Math.min(seg.end, dayE)
                  const top = Math.max(0, yOf(s, day))
                  const bottom = Math.min(gridHeight, yOf(e, day))
                  if (bottom <= top) return null
                  return (
                    <div
                      key={si}
                      data-seg={si}
                      onMouseDown={(ev) => onSegmentDown(ev, { start: s, end: e }, day, si)}
                      title="Sleep om een afspraak te boeken"
                      className="absolute inset-x-0 bg-white cursor-crosshair hover:bg-amber-50/40 transition-colors"
                      style={{ top, height: bottom - top }}
                    />
                  )
                })}

                {/* Actieve sleep-selectie */}
                {drag && segments[drag.segIdx] && drag.start >= day.getTime() && drag.start < day.getTime() + 86400000 && (
                  <div className="absolute inset-x-0.5 rounded bg-amber-300/70 border border-amber-500 pointer-events-none flex items-center justify-center"
                    style={{ top: yOf(drag.start, day), height: Math.max(14, yOf(drag.end, day) - yOf(drag.start, day)) }}>
                    <span className="text-[10px] font-semibold text-amber-900">{hhmm(drag.start)}–{hhmm(drag.end)}</span>
                  </div>
                )}

                {/* Bestaande afspraken bovenop */}
                {appointments.filter((a) => {
                  const s = new Date(a.starts_at).getTime()
                  return s >= day.getTime() && s < day.getTime() + 86400000
                }).map((a) => {
                  const s = new Date(a.starts_at).getTime()
                  const e = new Date(a.ends_at).getTime()
                  return (
                    <button key={a.id} type="button"
                      onMouseDown={(ev) => ev.stopPropagation()}
                      onClick={(ev) => { ev.stopPropagation(); setEditing(a) }}
                      className="absolute inset-x-0.5 rounded border px-1 py-0.5 overflow-hidden text-left bg-[#fff848] border-yellow-500 hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-black/30"
                      style={{ top: yOf(s, day), height: Math.max(16, yOf(e, day) - yOf(s, day)), zIndex: 10 }}
                      title={`${a.company ?? 'Afspraak'} — ${hhmm(s)}–${hhmm(e)} · klik om te bewerken`}>
                      <div className="text-[10px] font-semibold text-black truncate">{a.company ?? 'Afspraak'}</div>
                      <div className="text-[9px] text-black/70 truncate">{hhmm(s)}–{hhmm(e)}</div>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {loading && (
            <div className="absolute inset-0 bg-white/60 flex items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
            </div>
          )}
        </div>
      </div>

      <p className="text-[11px] text-gray-500">
        <span className="inline-block h-2.5 w-2.5 bg-white border border-gray-300 align-middle mr-1" /> vrij — sleep hierop om te boeken ·
        <span className="inline-block h-2.5 w-2.5 bg-gray-100 border border-gray-300 align-middle mx-1" /> niet beschikbaar (buiten werkuren, bezet of buffer) ·
        <span className="inline-block h-2.5 w-2.5 bg-[#fff848] border border-yellow-500 align-middle mx-1" /> geboekt — klik erop om te bewerken
      </p>

      {booking && (
        <BookingPanel
          start={booking.start}
          end={booking.end}
          pipelines={pipelines}
          initialLeadId={initialLeadId}
          ownerId={ownerId}
          ownerName={owners.find((o) => o.id === ownerId)?.name ?? null}
          onClose={() => setBooking(null)}
          onBooked={() => { setBooking(null); load() }}
        />
      )}

      {editing && (
        <EditAppointment
          appt={editing}
          pipelines={pipelines}
          isAdmin={isAdmin}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}

      {agendaDialog && (
        <AgendaDialog
          existing={agendaDialog === 'new' ? null : owners.find((o) => o.id === agendaDialog) ?? null}
          onClose={() => setAgendaDialog(null)}
          onSaved={() => { setAgendaDialog(null); load() }}
        />
      )}

      {showCalendars && ownerId && (
        <BusyCalendarsPanel
          connectionId={ownerId}
          ownerName={owners.find((o) => o.id === ownerId)?.name || 'deze agenda'}
          onClose={() => setShowCalendars(false)}
          onSaved={() => { setShowCalendars(false); load() }}
        />
      )}

      {showAvailability && (
        <AvailabilityPanel
          initialOwnerId={ownerId}
          onClose={() => setShowAvailability(false)}
          onSaved={() => { setShowAvailability(false); load() }}
        />
      )}

      {appointments.length > 0 && (
        <AppointmentList appointments={appointments} onChanged={load} />
      )}
    </div>
  )
}

// ── Boekingspaneel ───────────────────────────────────────────────────────────
function BookingPanel({ ownerId, ownerName, start, end, pipelines, initialLeadId, onClose, onBooked }: {
  ownerId: string; ownerName: string | null
  start: number; end: number
  pipelines: Pipeline[]; initialLeadId?: string
  onClose: () => void; onBooked: () => void
}) {
  const [lead, setLead] = useState<LeadOption | null>(null)
  const leadId = lead?.id ?? ''
  /**
   * Voor welk merk is deze afspraak? Standaard dat van de lead, maar je kunt
   * het wisselen: aan de telefoon blijkt soms dat iemand uit de ene pipeline
   * beter bij het andere merk past. `touched` onthoudt of je zelf gekozen hebt,
   * zodat een latere leadwissel jouw keuze niet stilletjes overschrijft.
   */
  const [pipelineId, setPipelineId] = useState(pipelines[0]?.id ?? '')
  const [touched, setTouched] = useState(false)
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [adres, setAdres] = useState('')
  const [clientNote, setClientNote] = useState('')
  const [withMeet, setWithMeet] = useState(true)
  const [saving, setSaving] = useState(false)

  const leadPipeline = lead ? pipelines.find((p) => p.id === lead.pipelineId) ?? null : null

  // Lead gekozen en zelf nog niets aangeduid → het merk van die lead volgen.
  useEffect(() => {
    if (!touched && leadPipeline) setPipelineId(leadPipeline.id)
  }, [touched, leadPipeline])

  const book = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/sales/appointments', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ownerId: ownerId || null, pipelineId: pipelineId || null,
          startsAt: start, endsAt: end,
          leadId: leadId || null, attendeeEmail: email.trim() || null,
          notes, clientNote, adres, withMeet,
        }),
      })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success(leadId ? 'Geboekt. De lead staat nu op “Afspraak ingepland”.' : 'Afspraak geboekt.')
      // De boeking is gelukt, maar de herinnering niet — dat mag niet stil
      // blijven, want dan merk je het pas als de prospect niet komt opdagen.
      if (j.reminderWarning) toast.warning(j.reminderWarning, { duration: 12000 })
      onBooked()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Boeken mislukt') } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] flex flex-col overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-gray-100">
          <div>
            <h3 className="font-semibold text-gray-900 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-gray-400" />Afspraak boeken</h3>
            <p className="text-sm text-gray-600 mt-0.5">
              {new Date(start).toLocaleDateString('nl-BE', { weekday: 'long', day: 'numeric', month: 'long' })} · {hhmm(start)}–{hhmm(end)}
            </p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100"><X className="h-4 w-4" /></button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Lead koppelen <span className="text-gray-400">— optioneel</span></label>
            <LeadKiezer waarde={lead} initialId={initialLeadId} onKies={setLead} />
            {leadId && <p className="text-[11px] text-gray-500 mt-1">Deze lead springt na het boeken naar “Afspraak ingepland”.</p>}
          </div>

          {/* Voor welk bedrijf is deze afspraak? Bepaalt de brochure en de
              afzender van de herinneringsmail die de dag ervoor uitgaat. */}
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Afspraak voor</label>
            <select className="input-base" value={pipelineId}
              onChange={(e) => { setTouched(true); setPipelineId(e.target.value) }}>
              {pipelines.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              Bepaalt welke one-pager en welke afzender bij de herinneringsmail horen.
              {leadPipeline && pipelineId !== leadPipeline.id && (
                <> De lead zelf blijft in <b>{leadPipeline.name}</b> staan; enkel deze afspraak telt voor het
                gekozen merk.</>
              )}
              {leadPipeline && pipelineId === leadPipeline.id && <> Overgenomen van de lead.</>}
            </p>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">E-mail prospect</label>
            <input type="email" className="input-base" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder={lead?.email ?? 'naam@bedrijf.be'} />
            <p className="text-[11px] text-gray-500 mt-1">
              Leeg laten = het adres van de lead. Vul je een ander adres in, dan wordt dat ook in de pipeline bijgewerkt.
            </p>
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
            <input type="checkbox" checked={withMeet} onChange={(e) => setWithMeet(e.target.checked)} className="h-4 w-4 rounded border-gray-300 accent-[#fff848]" />
            <span className="flex items-center gap-1.5"><Video className="h-3.5 w-3.5 text-gray-400" />Google Meet-link toevoegen</span>
          </label>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Adres van de afspraak</label>
            <textarea rows={2} className="input-base" value={adres} onChange={(e) => setAdres(e.target.value)}
              placeholder="Dorpsstraat 12, 2400 Mol" />
            <p className="text-[11px] text-gray-400 mt-1">
              Komt in het agenda-item als locatie, zodat de closer er rechtstreeks naartoe kan navigeren.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Briefing voor de closer</label>
            <textarea rows={3} className="input-base" value={notes} onChange={(e) => setNotes(e.target.value)}
              placeholder="Wat heb je gehoord aan de telefoon? Waar ligt de behoefte, wat is het budget, waar moet hij op inspelen?" />
            <p className="text-[11px] text-gray-400 mt-1">
              Dit staat in de agenda van Bram of Marco. Zij openen 's ochtends hun agenda en moeten daaraan
              genoeg hebben — zonder de app te openen.
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Afgesproken met de prospect</label>
            <textarea rows={2} className="input-base" value={clientNote} onChange={(e) => setClientNote(e.target.value)}
              placeholder="Bv. vraagt naar referenties uit zijn sector" />
          </div>
        </div>

        <div className="p-4 border-t border-gray-100 flex gap-2">
          <button onClick={book} disabled={saving} className="btn-primary flex-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}Boek &amp; sync met Google
          </button>
          <button onClick={onClose} className="btn-secondary">Annuleer</button>
        </div>
      </div>
    </div>
  )
}

// ── Lijst met geboekte afspraken (annuleren) ─────────────────────────────────
function AppointmentList({ appointments, onChanged }: { appointments: Appt[]; onChanged: () => void }) {
  const cancel = async (id: string) => {
    if (!confirm('Deze afspraak annuleren? Het agenda-item wordt verwijderd.')) return
    try {
      const res = await fetch(`/api/admin/sales/appointments?id=${id}`, { method: 'DELETE' })
      const j = await res.json(); if (!res.ok) throw new Error(j.error)
      toast.success('Afspraak geannuleerd.')
      onChanged()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Annuleren mislukt') }
  }
  return (
    <div className="card-base p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100 text-sm font-medium">Afspraken deze week ({appointments.length})</div>
      <div className="divide-y divide-gray-50">
        {appointments.map((a) => (
          <div key={a.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium truncate">{a.company ?? 'Afspraak'}{a.contact ? ` · ${a.contact}` : ''}</div>
              <div className="text-xs text-gray-500">
                {new Date(a.starts_at).toLocaleDateString('nl-BE', { weekday: 'short', day: 'numeric', month: 'short' })} · {hhmm(new Date(a.starts_at).getTime())}–{hhmm(new Date(a.ends_at).getTime())}
              </div>
            </div>
            <button onClick={() => cancel(a.id)} className="h-8 w-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600" title="Annuleren">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
