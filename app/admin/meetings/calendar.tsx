'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  Loader2, ChevronLeft, ChevronRight, List, CalendarDays, CalendarRange, Plus, Video, ExternalLink, Bell, BellOff,
  AlertTriangle, Settings2, UserRound, Link2, Check, X, MoveRight,
} from 'lucide-react'
import { Modal, focusRing } from '@/app/admin/materiaal/dialogen'
import { isBookable, mergeIntervals, snapToSlot, type Interval } from '@/lib/sales/availability'
import { dag, uur, datumKort, datumLang, maandagVan, plusDagen, zoneNaarIso, STANDAARD_TIJDZONE } from '@/lib/meetings/model'
import { BRON_LABEL, GSM_MELDING_MIN, type KalenderItem, type KalenderBron } from '@/lib/meetings/kalender'
import { PlanVenster, DetailVenster, AnnuleerVenster, api, type Opties, type Meeting } from './meetings-client'
import { BookingPanel } from '@/app/admin/sales/appointments/calendar'
import { EditAppointment } from '@/app/admin/sales/appointments/edit-appointment'
import { AgendaDialog } from '@/app/admin/sales/appointments/agenda-dialog'
import { BusyCalendarsPanel } from '@/app/admin/sales/appointments/busy-calendars'
import { AvailabilityPanel } from '@/app/admin/sales/appointments/availability-panel'

/**
 * Calendar — de centrale agenda van de Meeting Inplanner.
 *
 * Eén persoon tegelijk ("Agenda van"), in drie weergaven: lijst, week en maand.
 * Toont alle meetings uit de app, verkoopafspraken, ClickUp-meetings (enkel
 * met start- én einduur) en losse Google-afspraken, elk één keer. In de week
 * is wit = echt vrij (werkuren min alles wat bezet is); sleep daarop om te
 * plannen, of sleep een bestaande meeting om ze te verplaatsen. Op een
 * touchscreen: tik op een vrij moment om te plannen, verplaatsen via de meeting.
 * Alle tijden in Europe/Brussels.
 */

type Weergave = 'lijst' | 'week' | 'maand'
type Agenda = {
  id: string; name: string; account_email: string | null; status: string
  pipeline_id?: string | null; clickup_assignee_id?: number | null
  signature_image_url?: string | null; signature_phone?: string | null; signature_email?: string | null
}
type Data = {
  agendas: Agenda[]; agendaId: string | null; items: KalenderItem[]; segmenten: Interval[]
  beschikbaarheid: { ok: boolean; fout: string | null }
  bronnen: { google: { ok: boolean; fout: string | null }; clickup: { ok: boolean; fout: string | null } }
  syncWaarschuwing: string | null
  regels: { slotMin: number; duurMin: number; tijdzone: string }
}
type Pipeline = { id: string; key: string; name: string; defaultCalendarId?: string | null }
type SalesClient = { id: string; name: string; timezone: string; slot_interval_min: number; default_duration_min: number }

type Venster =
  | { soort: 'kies'; start: number; eind: number; op: number; vrij: boolean }
  | { soort: 'plan'; start: number; eind: number }
  | { soort: 'nieuw' }
  | { soort: 'lead'; start: number; eind: number }
  | { soort: 'detail'; id: string }
  | { soort: 'wijzig'; meeting: Meeting }
  | { soort: 'annuleer'; meeting: Meeting }
  | { soort: 'afspraak'; appt: Record<string, unknown> }
  | { soort: 'info'; item: KalenderItem }
  | { soort: 'verplaats'; item: KalenderItem; start: number; eind: number }
  | { soort: 'agenda'; id: 'new' | string }
  | { soort: 'agendas' }
  | { soort: 'werkuren' }
  | null

const DAG_START = 7
const DAG_EIND = 21
const PX = 0.9
const MIN = 60000
const vandaag = () => dag(new Date().toISOString())
/** Na een tik op een touchscreen stuurt de browser nog een klik op dezelfde plek: die negeren we even. */
const spookklik = (geopendOp: number) => Date.now() - geopendOp < 400
const topMs = (d: string) => Date.parse(zoneNaarIso(d, `${String(DAG_START).padStart(2, '0')}:00`))
const yVan = (ms: number, d: string) => ((ms - topMs(d)) / MIN) * PX
const HOOGTE = (DAG_EIND - DAG_START) * 60 * PX
const weekdag = (d: string) => new Date(`${d}T12:00:00Z`).getUTCDay()
const isWeekend = (d: string) => weekdag(d) === 0 || weekdag(d) === 6
const kort = (d: string, o: Intl.DateTimeFormatOptions) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { timeZone: 'UTC', ...o })

const STIJL: Record<KalenderBron, string> = {
  meeting: 'bg-gray-900 text-white border-gray-900',
  klantboeking: 'bg-gray-700 text-white border-gray-700',
  afspraak: 'bg-amber-100 text-amber-950 border-amber-400',
  clickup: 'bg-violet-50 text-violet-950 border-violet-300',
  google: 'bg-sky-50 text-sky-950 border-sky-300',
}

/** Overlappende items naast elkaar: per groep een kolom (baan) per item. */
function banen(items: KalenderItem[]): Map<string, { baan: number; van: number }> {
  const uit = new Map<string, { baan: number; van: number }>()
  let groep: { key: string; baan: number }[] = []
  let eindes: number[] = []
  let groepEind = -Infinity
  const sluit = () => { for (const g of groep) uit.set(g.key, { baan: g.baan, van: eindes.length }); groep = []; eindes = [] }
  for (const it of [...items].sort((a, b) => a.start.localeCompare(b.start))) {
    const s = Date.parse(it.start), e = Date.parse(it.eind)
    if (s >= groepEind) { sluit(); groepEind = -Infinity }
    let baan = eindes.findIndex((x) => x <= s)
    if (baan === -1) { baan = eindes.length; eindes.push(e) } else eindes[baan] = e
    groep.push({ key: it.key, baan })
    groepEind = Math.max(groepEind, e)
  }
  sluit()
  return uit
}

function GsmIcoon({ gsm }: { gsm: KalenderItem['gsm'] }) {
  if (gsm === 'ingesteld') return <Bell className="h-3 w-3 shrink-0" aria-label={`Gsm-melding ${GSM_MELDING_MIN} min vooraf`} />
  if (gsm === 'mislukt') return <BellOff className="h-3 w-3 shrink-0 text-red-600" aria-label="Gsm-melding mislukt" />
  return null
}

const gsmTekst = (i: KalenderItem): string => {
  if (i.gsm === 'ingesteld') return `Ingesteld: ${GSM_MELDING_MIN} minuten vooraf via de Google Agenda-app.`
  if (i.gsm === 'mislukt') return 'Mislukt. Open de meeting om het opnieuw te proberen.'
  if (i.gsm === 'wacht') return i.bron === 'clickup'
    ? 'Nog niet in Google: de ClickUp-agendasync zet deze meeting binnen een paar minuten in Google, met de melding erbij.'
    : 'Wordt binnen enkele minuten ingesteld in Google Agenda.'
  return 'Een afspraak die rechtstreeks in Google staat: de melding volgt je eigen instellingen in Google Agenda.'
}

export function Calendar({ client, pipelines, isAdmin, verkoop, initialLeadId, initialMerkId, initialAppt }: {
  client: SalesClient
  pipelines: Pipeline[]
  isAdmin?: boolean
  /** Mag deze gebruiker verkoopafspraken (leads) boeken en agenda's beheren? */
  verkoop: boolean
  initialLeadId?: string
  initialMerkId?: string
  initialAppt?: { id: string; startsAt: string; calendarId: string | null } | null
}) {
  const [weergave, setWeergave] = useState<Weergave>('week')
  const [datum, setDatum] = useState(() => {
    if (initialAppt) return dag(initialAppt.startsAt)
    const d = vandaag()
    // In het weekend: meteen de komende werkweek, anders zie je enkel verleden en weekend.
    return isWeekend(d) ? plusDagen(maandagVan(d), 7) : d
  })
  const standaardAgenda = initialAppt?.calendarId
    ?? (initialMerkId ? pipelines.find((p) => p.id === initialMerkId)?.defaultCalendarId : null) ?? ''
  const [agendaId, setAgendaId] = useState<string>(standaardAgenda ?? '')
  const [data, setData] = useState<Data | null>(null)
  const [laden, setLaden] = useState(true)
  const [fout, setFout] = useState<string | null>(null)
  const [opties, setOpties] = useState<Opties | null>(null)
  const [venster, setVenster] = useState<Venster>(null)
  const geopendAppt = useRef(false)

  // Weergave onthouden (per toestel); op een smalle gsm standaard de lijst.
  useEffect(() => {
    try {
      const w = localStorage.getItem('ngm-calendar-weergave')
      if (w === 'lijst' || w === 'week' || w === 'maand') setWeergave(w)
      else if (window.innerWidth < 640) setWeergave('lijst')
    } catch { /* geen opslag: standaard blijft */ }
  }, [])
  const kiesWeergave = (w: Weergave) => { setWeergave(w); try { localStorage.setItem('ngm-calendar-weergave', w) } catch { /* */ } }

  useEffect(() => { api<Opties>('/api/admin/meetings?opties=1').then(setOpties).catch(() => setOpties(null)) }, [])

  // ── Venster per weergave ───────────────────────────────────────────────────
  const maandag = maandagVan(datum)
  const venstr = useMemo(() => {
    if (weergave === 'week') return { van: Date.parse(zoneNaarIso(maandag, '00:00')), tot: Date.parse(zoneNaarIso(plusDagen(maandag, 7), '00:00')), vrij: true }
    if (weergave === 'maand') {
      const eerste = maandagVan(`${datum.slice(0, 8)}01`)
      return { van: Date.parse(zoneNaarIso(eerste, '00:00')), tot: Date.parse(zoneNaarIso(plusDagen(eerste, 42), '00:00')), vrij: false }
    }
    const start = datum < vandaag() ? datum : vandaag()
    return { van: Math.max(Date.now() - 3600_000, Date.parse(zoneNaarIso(start, '00:00'))), tot: Date.parse(zoneNaarIso(plusDagen(start, 42), '00:00')), vrij: false }
  }, [weergave, datum, maandag])

  const laad = useCallback(async () => {
    setLaden(true)
    try {
      const p = new URLSearchParams({ van: String(venstr.van), tot: String(venstr.tot), vrij: venstr.vrij ? '1' : '0' })
      if (agendaId) p.set('agenda', agendaId)
      const j = await api<Data>(`/api/admin/meetings/kalender?${p}`)
      setData(j); setFout(null)
      if (j.agendaId && j.agendaId !== agendaId) setAgendaId(j.agendaId)
    } catch (e) { setFout(e instanceof Error ? e.message : 'Calendar laden mislukt') } finally { setLaden(false) }
  }, [venstr, agendaId])
  useEffect(() => { laad() }, [laad])

  const agenda = data?.agendas.find((a) => a.id === (data?.agendaId ?? agendaId)) ?? null
  const slot = data?.regels.slotMin ?? client.slot_interval_min ?? 30
  const duur = data?.regels.duurMin ?? client.default_duration_min ?? 30
  const kanMeeting = !!opties?.rechten.toevoegen
  const kanAanpassen = !!opties?.rechten.aanpassen

  // ── Een verkoopafspraak openen (bewerken met de bestaande regels) ──────────
  const openAfspraak = useCallback(async (id: string, start: string, eind: string) => {
    try {
      const p = new URLSearchParams({ from: String(Date.parse(start) - 3600_000), to: String(Date.parse(eind) + 3600_000) })
      if (agenda) p.set('owner', agenda.id)
      const j = await api<{ appointments: Record<string, unknown>[] }>(`/api/admin/sales/calendar?${p}`)
      const appt = j.appointments.find((a) => a.id === id)
      if (!appt) throw new Error('Deze afspraak kon niet geladen worden.')
      setVenster({ soort: 'afspraak', appt })
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Openen mislukt') }
  }, [agenda])

  // Deeplink: ?afspraak=<id> opent die verkoopafspraak meteen.
  useEffect(() => {
    if (!initialAppt || geopendAppt.current || !data) return
    const it = data.items.find((i) => i.bron === 'afspraak' && i.id === initialAppt.id)
    if (it) { geopendAppt.current = true; openAfspraak(it.id, it.start, it.eind) }
  }, [data, initialAppt, openAfspraak])

  const sluit = useCallback(() => setVenster(null), [])
  const open = (i: KalenderItem) => {
    if (i.bron === 'meeting' || i.bron === 'klantboeking') setVenster({ soort: 'detail', id: i.id })
    else if (i.bron === 'afspraak' && verkoop && i.verplaatsbaar) openAfspraak(i.id, i.start, i.eind)
    else setVenster({ soort: 'info', item: i })
  }

  /**
   * Moment gekozen (gesleept of getikt): wat plannen we? Een interne meeting mag
   * op elk tijdstip (een overlap is een waarschuwing bij het opslaan). Een
   * verkoopafspraak voor een lead volgt de setterregels: enkel op wit (vrij).
   */
  const kiesMoment = (start: number, eind: number) => {
    const vrij = !!data?.beschikbaarheid.ok && isBookable(data.segmenten, start, eind)
    const leadNietVrij = () => toast.error('Een afspraak voor een lead boek je op een wit (vrij) moment binnen de werkuren.')
    if (initialLeadId && verkoop) return vrij ? setVenster({ soort: 'lead', start, eind }) : leadNietVrij()
    if (!opties && !verkoop) { toast('Even geduld, de planner laadt nog.'); return }
    if (kanMeeting && verkoop) return setVenster({ soort: 'kies', start, eind, op: Date.now(), vrij })
    if (kanMeeting) return setVenster({ soort: 'plan', start, eind })
    if (verkoop) return vrij ? setVenster({ soort: 'lead', start, eind }) : leadNietVrij()
    toast.error('Je mag hier geen meetings plannen.')
  }

  const mag = (i: KalenderItem) => i.verplaatsbaar && (i.bron === 'afspraak' ? verkoop : kanAanpassen || (i.bron === 'klantboeking' && verkoop))
    && Date.parse(i.start) > Date.now()

  // ── Navigatie ──────────────────────────────────────────────────────────────
  const stap = (n: number) => {
    if (weergave === 'week') setDatum(plusDagen(maandag, 7 * n))
    else if (weergave === 'maand') { const [j, m] = datum.split('-').map(Number); const d = new Date(Date.UTC(j, m - 1 + n, 1)); setDatum(d.toISOString().slice(0, 10)) }
    else setDatum(plusDagen(datum < vandaag() ? vandaag() : datum, 42 * n))
  }
  const label = weergave === 'week'
    ? `${kort(maandag, { day: 'numeric', month: 'short' })} – ${kort(plusDagen(maandag, 6), { day: 'numeric', month: 'short', year: 'numeric' })}`
    : weergave === 'maand' ? kort(`${datum.slice(0, 8)}15`, { month: 'long', year: 'numeric' })
      : `Vanaf ${kort(datum < vandaag() ? vandaag() : datum, { weekday: 'short', day: 'numeric', month: 'short' })}`

  const vrijDezeWeek = weergave === 'week' && data?.beschikbaarheid.ok ? data.segmenten.filter((s) => s.end > Date.now()).length : null

  return (
    <div className="space-y-3">
      {/* Kop: wiens agenda, weergave, navigatie */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {data && data.agendas.length > 0 && (
            <label className="flex items-center gap-1.5 text-sm text-gray-700">
              <span className="hidden sm:inline">Agenda van</span>
              <select className="input-base !w-auto !py-1.5" value={data.agendaId ?? ''} onChange={(e) => setAgendaId(e.target.value)} aria-label="Agenda van">
                {data.agendas.map((a) => {
                  const merk = pipelines.find((p) => p.id === a.pipeline_id)
                  return <option key={a.id} value={a.id}>{merk ? `${a.name} — ${merk.name}` : a.name}</option>
                })}
              </select>
            </label>
          )}
          <div className="inline-flex rounded-xl border border-gray-200 bg-gray-50 p-1" role="group" aria-label="Weergave">
            {([['lijst', 'Lijst', List], ['week', 'Week', CalendarDays], ['maand', 'Maand', CalendarRange]] as [Weergave, string, typeof List][]).map(([k, l, I]) => (
              <button key={k} type="button" onClick={() => kiesWeergave(k)} aria-pressed={weergave === k}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-sm ${weergave === k ? 'bg-black text-white' : 'text-gray-700 hover:bg-white'} ${focusRing}`}>
                <I className="h-4 w-4" aria-hidden />{l}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {kanMeeting && (
            <button type="button" onClick={() => setVenster({ soort: 'nieuw' })} className={`btn-primary ${focusRing}`}><Plus className="h-4 w-4" />Meeting plannen</button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1">
          <button type="button" onClick={() => stap(-1)} className={`btn-secondary !px-2 ${focusRing}`} aria-label="Vorige"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setDatum(vandaag())} className={`btn-secondary ${focusRing}`}>Vandaag</button>
          <button type="button" onClick={() => stap(1)} className={`btn-secondary !px-2 ${focusRing}`} aria-label="Volgende"><ChevronRight className="h-4 w-4" /></button>
          <span className="text-sm font-medium text-gray-800 ml-1.5 first-letter:uppercase">{label}</span>
          {laden && <Loader2 className="h-4 w-4 animate-spin text-gray-400 ml-1" aria-label="Laden" />}
        </div>
        {verkoop && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {agenda && <button type="button" onClick={() => setVenster({ soort: 'agenda', id: agenda.id })} className={`btn-secondary !py-1 text-xs ${focusRing}`} title="Naam, merk, ClickUp-persoon en handtekening"><UserRound className="h-3.5 w-3.5" />Agenda bewerken</button>}
            {agenda && <button type="button" onClick={() => setVenster({ soort: 'agendas' })} className={`btn-secondary !py-1 text-xs ${focusRing}`} title="Welke Google-agenda's als bezet tellen"><CalendarRange className="h-3.5 w-3.5" />Agenda&apos;s</button>}
            <button type="button" onClick={() => setVenster({ soort: 'werkuren' })} className={`btn-secondary !py-1 text-xs ${focusRing}`} title="Werkuren, buffers en boekingsregels"><Settings2 className="h-3.5 w-3.5" />Werkuren</button>
            <button type="button" onClick={() => setVenster({ soort: 'agenda', id: 'new' })} className={`btn-secondary !py-1 text-xs ${focusRing}`}><Link2 className="h-3.5 w-3.5" />Agenda toevoegen</button>
          </div>
        )}
      </div>

      {initialLeadId && verkoop && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">Je plant een afspraak voor een lead uit de pipeline. Sleep (of tik) op een vrij moment in de week.</p>
      )}

      {/* Status: nooit stil falen */}
      {fout && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">{fout}</p>}
      {data && weergave === 'week' && !data.beschikbaarheid.ok && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex gap-2" role="alert"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><span><b>Geen vrije momenten getoond.</b> {data.beschikbaarheid.fout}</span></p>
      )}
      {data && weergave !== 'week' && (data.bronnen.google.fout || data.bronnen.clickup.fout) && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 flex gap-2" role="alert"><AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" /><span>Niet alle meetings konden geladen worden. {[data.bronnen.google.fout, data.bronnen.clickup.fout].filter(Boolean).join(' ')}</span></p>
      )}
      {data?.syncWaarschuwing && <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">{data.syncWaarschuwing}</p>}
      {data && agenda && agenda.status !== 'connected' && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800" role="alert">De Google-koppeling van &quot;{agenda.name}&quot; werkt niet meer. Koppel ze opnieuw via &quot;Agenda toevoegen&quot;.</p>
      )}
      {vrijDezeWeek === 0 && (
        <p className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700 flex items-center justify-between gap-2 flex-wrap">
          <span>Geen vrije momenten meer in deze week binnen de werkuren.</span>
          <button type="button" onClick={() => stap(1)} className={`btn-secondary !py-1 text-xs ${focusRing}`}>Volgende week<ChevronRight className="h-3.5 w-3.5" /></button>
        </p>
      )}

      {data && weergave === 'week' && (
        <Week data={data} maandag={maandag} slot={slot} duur={duur} magVerplaatsen={mag} onOpen={open} onMoment={kiesMoment}
          onVerplaats={(item, start, eind) => setVenster({ soort: 'verplaats', item, start, eind })} />
      )}
      {data && weergave === 'maand' && <Maand items={data.items} datum={datum} onOpen={open} onDag={(d) => { setDatum(d); kiesWeergave('week') }} />}
      {data && weergave === 'lijst' && <Lijst items={data.items.filter((i) => Date.parse(i.eind) > Date.now())} onOpen={open} />}
      {!data && !fout && <div className="card-base flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}

      <Legenda week={weergave === 'week'} />

      {/* ── Vensters ───────────────────────────────────────────────────────── */}
      {venster?.soort === 'kies' && (
        <Modal titel="Wat wil je plannen?" sub={`${datumLang(new Date(venster.start).toISOString())}, ${uur(new Date(venster.start).toISOString())}–${uur(new Date(venster.eind).toISOString())} (Belgische tijd)`} onSluit={() => setVenster(null)}>
          <div className="grid gap-2">
            <button type="button" onClick={() => { if (!spookklik(venster.op)) setVenster({ soort: 'plan', start: venster.start, eind: venster.eind }) }} className={`card-base !p-3 text-left hover:border-gray-400 ${focusRing}`}>
              <div className="font-medium flex items-center gap-2"><Video className="h-4 w-4" />Meeting met Google Meet</div>
              <div className="text-xs text-gray-600 mt-0.5">Met of zonder klant: echte Meet-link, uitnodiging, ClickUp en herinneringen.</div>
            </button>
            <button type="button" disabled={!venster.vrij} onClick={() => { if (!spookklik(venster.op)) setVenster({ soort: 'lead', start: venster.start, eind: venster.eind }) }} className={`card-base !p-3 text-left hover:border-gray-400 disabled:opacity-50 disabled:hover:border-gray-200 ${focusRing}`}>
              <div className="font-medium flex items-center gap-2"><CalendarDays className="h-4 w-4" />Afspraak voor een lead</div>
              <div className="text-xs text-gray-600 mt-0.5">{venster.vrij ? 'Verkoopafspraak uit de pipeline, met setter, merk en uitkomst zoals altijd.' : 'Kan enkel op een wit (vrij) moment binnen de werkuren.'}</div>
            </button>
          </div>
          {!venster.vrij && <p className="text-xs text-amber-800">Dit moment valt buiten de werkuren of overlapt met iets anders. Een interne meeting kan toch: je krijgt bij het opslaan een waarschuwing als er iets overlapt.</p>}
        </Modal>
      )}
      {(venster?.soort === 'plan' || venster?.soort === 'nieuw') && opties && (
        <PlanVenster opties={opties} bestaand={null}
          voorinvul={venster.soort === 'plan'
            ? { dag: dag(new Date(venster.start).toISOString()), uur: uur(new Date(venster.start).toISOString()), duur: Math.round((venster.eind - venster.start) / MIN), agendaId: agenda?.id ?? null }
            : { dag: datum < vandaag() ? vandaag() : datum, uur: '10:00', duur, agendaId: agenda?.id ?? null }}
          controleerVrij
          onSluit={() => setVenster(null)} onOpen={(id) => setVenster({ soort: 'detail', id })}
          onKlaar={(m, melding) => { if (melding) toast.success(melding); laad(); setVenster({ soort: 'detail', id: m.id }) }} />
      )}
      {(venster?.soort === 'plan' || venster?.soort === 'nieuw') && !opties && (
        <Modal titel="Meeting plannen" onSluit={() => setVenster(null)}><div className="py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div></Modal>
      )}
      {venster?.soort === 'lead' && agenda && (
        <BookingPanel start={venster.start} end={venster.eind} pipelines={pipelines} initialLeadId={initialLeadId}
          merkVoorkeur={agenda.pipeline_id ?? initialMerkId ?? undefined} merkVast={!!agenda.pipeline_id}
          ownerId={agenda.id} ownerName={agenda.name}
          onClose={() => setVenster(null)} onBooked={() => { setVenster(null); laad() }} />
      )}
      {venster?.soort === 'detail' && opties && (
        <DetailVenster id={venster.id} opties={opties} onSluit={sluit} onVeranderd={laad}
          onWijzig={(m) => setVenster({ soort: 'wijzig', meeting: m })} onAnnuleer={(m) => setVenster({ soort: 'annuleer', meeting: m })} />
      )}
      {venster?.soort === 'wijzig' && opties && (
        <PlanVenster opties={opties} bestaand={venster.meeting} controleerVrij onSluit={() => setVenster({ soort: 'detail', id: venster.meeting.id })}
          onOpen={(id) => setVenster({ soort: 'detail', id })}
          onKlaar={(m, melding) => { if (melding) toast.success(melding); laad(); setVenster({ soort: 'detail', id: m.id }) }} />
      )}
      {venster?.soort === 'annuleer' && (
        <AnnuleerVenster m={venster.meeting} onSluit={() => setVenster({ soort: 'detail', id: venster.meeting.id })}
          onKlaar={(m) => { toast.success('Meeting geannuleerd.'); laad(); setVenster({ soort: 'detail', id: m.id }) }} />
      )}
      {venster?.soort === 'afspraak' && (
        <EditAppointment appt={venster.appt as never} pipelines={pipelines} owners={(data?.agendas ?? []) as never} isAdmin={isAdmin}
          onClose={() => setVenster(null)} onSaved={() => { setVenster(null); laad() }} />
      )}
      {venster?.soort === 'info' && <InfoVenster item={venster.item} onSluit={() => setVenster(null)} />}
      {venster?.soort === 'verplaats' && data && (
        <VerplaatsVenster item={venster.item} start={venster.start} eind={venster.eind} segmenten={data.segmenten} beschikbaar={data.beschikbaarheid.ok} items={data.items}
          onSluit={() => setVenster(null)} onKlaar={() => { setVenster(null); laad() }} />
      )}
      {venster?.soort === 'agenda' && (
        <AgendaDialog pipelines={pipelines} owners={(data?.agendas ?? []) as never} isAdmin={isAdmin}
          existing={venster.id === 'new' ? null : (data?.agendas.find((a) => a.id === venster.id) ?? null) as never}
          onClose={() => setVenster(null)} onSaved={() => { setVenster(null); laad() }} />
      )}
      {venster?.soort === 'agendas' && agenda && (
        <BusyCalendarsPanel connectionId={agenda.id} ownerName={agenda.name || 'deze agenda'} onClose={() => setVenster(null)} onSaved={() => { setVenster(null); laad() }} />
      )}
      {venster?.soort === 'werkuren' && (
        <AvailabilityPanel initialOwnerId={agenda?.id ?? ''} onClose={() => setVenster(null)} onSaved={() => { setVenster(null); laad() }} />
      )}
    </div>
  )
}

// ── Week ─────────────────────────────────────────────────────────────────────

function Week({ data, maandag, slot, duur, magVerplaatsen, onOpen, onMoment, onVerplaats }: {
  data: Data; maandag: string; slot: number; duur: number
  magVerplaatsen: (i: KalenderItem) => boolean
  onOpen: (i: KalenderItem) => void
  onMoment: (start: number, eind: number) => void
  onVerplaats: (i: KalenderItem, start: number, eind: number) => void
}) {
  const dagen = useMemo(() => Array.from({ length: 7 }, (_, i) => plusDagen(maandag, i)), [maandag])
  const segmenten = data.segmenten
  const [selectie, zetSelectieState] = useState<{ dag: string; start: number; eind: number } | null>(null)
  const [geest, zetGeestState] = useState<{ key: string; dag: string; start: number; eind: number } | null>(null)
  // Dezelfde waarden in een ref: bij het loslaten lezen we ze zonder neveneffecten in een state-updater.
  const selectieRef = useRef<typeof selectie>(null)
  const geestRef = useRef<typeof geest>(null)
  const setSelectie = (v: typeof selectie) => { selectieRef.current = v; zetSelectieState(v) }
  const setGeest = (v: typeof geest) => { geestRef.current = v; zetGeestState(v) }
  const viaTouch = useRef(false)
  const sleep = useRef<{ soort: 'nieuw'; dag: string; anker: number; seg: Interval } | { soort: 'item'; item: KalenderItem; offset: number; x: number; y: number; bewogen: boolean } | null>(null)
  const tik = useRef<{ x: number; y: number; dag: string; ms: number } | null>(null)
  const kolommen = useRef<Map<string, HTMLDivElement>>(new Map())
  const [nu, setNu] = useState(() => Date.now())
  useEffect(() => { const t = setInterval(() => setNu(Date.now()), 60_000); return () => clearInterval(t) }, [])

  const msOp = (d: string, clientY: number): number => {
    const el = kolommen.current.get(d)
    if (!el) return topMs(d)
    return topMs(d) + ((clientY - el.getBoundingClientRect().top) / PX) * MIN
  }
  const dagOnder = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-dag]') as HTMLElement | null
    return el?.dataset.dag ?? null
  }

  const itemsPerDag = useMemo(() => {
    const m = new Map<string, KalenderItem[]>()
    for (const d of dagen) m.set(d, [])
    for (const it of data.items) {
      const d = dag(it.start)
      if (m.has(d)) m.get(d)!.push(it)
    }
    return m
  }, [data.items, dagen])

  // Slepen: op de hele pagina volgen, loslaten = klaar.
  useEffect(() => {
    const beweeg = (ev: PointerEvent) => {
      const s = sleep.current
      if (!s) return
      if (s.soort === 'nieuw') {
        let cursor = snapToSlot(msOp(s.dag, ev.clientY), slot, 'ceil')
        cursor = Math.min(Math.max(cursor, s.seg.start), s.seg.end)
        const start = Math.min(s.anker, cursor), eind = Math.max(s.anker, cursor)
        setSelectie({ dag: s.dag, start, eind: Math.min(Math.max(eind, start + slot * MIN), s.seg.end) })
      } else {
        if (!s.bewogen && Math.hypot(ev.clientX - s.x, ev.clientY - s.y) < 6) return
        s.bewogen = true
        const d = dagOnder(ev.clientX, ev.clientY)
        if (!d) return
        const lengte = Date.parse(s.item.eind) - Date.parse(s.item.start)
        const start = snapToSlot(msOp(d, ev.clientY) - s.offset, slot)
        setGeest({ key: s.item.key, dag: d, start, eind: start + lengte })
      }
    }
    const los = () => {
      const s = sleep.current
      sleep.current = null
      if (!s) return
      if (s.soort === 'nieuw') {
        const sel = selectieRef.current
        setSelectie(null)
        if (sel && sel.eind > sel.start) onMoment(sel.start, sel.eind)
      } else {
        const g = geestRef.current
        setGeest(null)
        if (!s.bewogen) onOpen(s.item)
        else if (g && g.start !== Date.parse(s.item.start)) onVerplaats(s.item, g.start, g.eind)
      }
    }
    window.addEventListener('pointermove', beweeg)
    window.addEventListener('pointerup', los)
    window.addEventListener('pointercancel', los)
    return () => { window.removeEventListener('pointermove', beweeg); window.removeEventListener('pointerup', los); window.removeEventListener('pointercancel', los) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slot, segmenten, onMoment, onOpen, onVerplaats])

  /**
   * Intern mag je overal plannen: op wit (vrij) én daarbuiten. Het venster om in
   * te slepen is de zichtbare dag, nooit het verleden. Wat buiten wit valt,
   * wordt oranje: bij het opslaan volgt dan een waarschuwing bij een overlap.
   */
  const dagGrens = (d: string): Interval => ({
    start: Math.max(topMs(d), snapToSlot(Date.now(), slot, 'ceil')),
    end: topMs(d) + (DAG_EIND - DAG_START) * 60 * MIN,
  })
  const opKolomNeer = (ev: React.PointerEvent, d: string) => {
    if (ev.button !== 0) return
    const ms = msOp(d, ev.clientY)
    const grens = dagGrens(d)
    if (ev.pointerType === 'touch') {
      // Touch: niet slepen (dan scroll je), maar tikken.
      tik.current = ms >= grens.start ? { x: ev.clientX, y: ev.clientY, dag: d, ms } : null
      return
    }
    if (ms < grens.start || grens.end - grens.start < slot * MIN) return
    ev.preventDefault()
    const anker = Math.min(Math.max(snapToSlot(ms, slot), grens.start), grens.end - slot * MIN)
    sleep.current = { soort: 'nieuw', dag: d, anker, seg: grens }
    setSelectie({ dag: d, start: anker, eind: Math.min(anker + duur * MIN, grens.end) })
  }
  const opKolomOp = (ev: React.PointerEvent) => {
    const t = tik.current
    tik.current = null
    if (!t || ev.pointerType !== 'touch' || Math.hypot(ev.clientX - t.x, ev.clientY - t.y) > 10) return
    const grens = dagGrens(t.dag)
    if (grens.end - grens.start < slot * MIN) return
    const start = Math.min(Math.max(snapToSlot(t.ms, slot), grens.start), grens.end - slot * MIN)
    onMoment(start, Math.min(start + duur * MIN, grens.end))
  }
  const opItemNeer = (ev: React.PointerEvent, it: KalenderItem, d: string) => {
    ev.stopPropagation()
    viaTouch.current = ev.pointerType === 'touch'
    if (ev.pointerType === 'touch' || !magVerplaatsen(it) || ev.button !== 0) return
    ev.preventDefault()
    sleep.current = { soort: 'item', item: it, offset: msOp(d, ev.clientY) - Date.parse(it.start), x: ev.clientX, y: ev.clientY, bewogen: false }
  }

  const vandaagD = vandaag()

  return (
    <div className="card-base !p-0 overflow-hidden">
      <div className="overflow-x-auto">
        <div className="min-w-[720px]">
          <div className="grid grid-cols-[48px_repeat(7,1fr)] border-b border-gray-200">
            <div />
            {dagen.map((d) => (
              <div key={d} className={`px-1 py-2 text-center border-l border-gray-100 ${d === vandaagD ? 'bg-gray-900 text-white' : ''}`}>
                <div className={`text-[11px] uppercase ${d === vandaagD ? 'text-gray-300' : 'text-gray-500'}`}>{kort(d, { weekday: 'short' })}</div>
                <div className="text-sm font-semibold tabular-nums">{kort(d, { day: 'numeric', month: 'short' })}</div>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-[48px_repeat(7,1fr)] select-none" style={{ height: HOOGTE }}>
            <div className="relative">
              {Array.from({ length: DAG_EIND - DAG_START }, (_, i) => (
                <div key={i} className="absolute right-1.5 text-[10px] text-gray-500 tabular-nums" style={{ top: i * 60 * PX - 6 }}>{String(DAG_START + i).padStart(2, '0')}:00</div>
              ))}
            </div>
            {dagen.map((d) => {
              const items = itemsPerDag.get(d) ?? []
              const b = banen(items)
              const dagTop = topMs(d), dagBodem = dagTop + (DAG_EIND - DAG_START) * 60 * MIN
              const wit = mergeIntervals(segmenten.filter((s) => s.end > dagTop && s.start < dagBodem).map((s) => ({ start: Math.max(s.start, dagTop), end: Math.min(s.end, dagBodem) })))
              return (
                <div key={d} data-dag={d} ref={(el) => { if (el) kolommen.current.set(d, el); else kolommen.current.delete(d) }}
                  onPointerDown={(ev) => opKolomNeer(ev, d)} onPointerUp={opKolomOp}
                  className="relative border-l border-gray-200 bg-niet-vrij">
                  {/* uurlijnen */}
                  {Array.from({ length: DAG_EIND - DAG_START }, (_, i) => <div key={i} className="absolute inset-x-0 border-t border-gray-200/70 pointer-events-none" style={{ top: i * 60 * PX }} />)}
                  {/* vrij = wit */}
                  {wit.map((s, i) => (
                    <div key={i} className="absolute inset-x-0 bg-white hover:bg-emerald-50/60 cursor-crosshair border-y border-emerald-200/60"
                      style={{ top: yVan(s.start, d), height: yVan(s.end, d) - yVan(s.start, d) }} title="Vrij: sleep (of tik) om te plannen" />
                  ))}
                  {/* nu-lijn */}
                  {nu > dagTop && nu < dagBodem && <div className="absolute inset-x-0 border-t-2 border-red-500 pointer-events-none z-20" style={{ top: yVan(nu, d) }} />}
                  {/* selectie */}
                  {selectie?.dag === d && (
                    <div className={`absolute inset-x-0.5 rounded border pointer-events-none flex items-center justify-center z-30 ${isBookable(segmenten, selectie.start, selectie.eind) ? 'bg-emerald-300/70 border-emerald-600' : 'bg-amber-300/70 border-amber-600'}`}
                      style={{ top: yVan(selectie.start, d), height: Math.max(14, yVan(selectie.eind, d) - yVan(selectie.start, d)) }}>
                      <span className="text-[10px] font-semibold text-emerald-950">{uur(new Date(selectie.start).toISOString())}–{uur(new Date(selectie.eind).toISOString())}</span>
                    </div>
                  )}
                  {/* items */}
                  {items.map((it) => {
                    const s = Math.max(Date.parse(it.start), dagTop), e = Math.min(Date.parse(it.eind), dagBodem)
                    if (e <= dagTop || s >= dagBodem) return null
                    const plek = b.get(it.key) ?? { baan: 0, van: 1 }
                    const breed = 100 / plek.van
                    const sleepbaar = magVerplaatsen(it)
                    return (
                      <button key={it.key} type="button" onPointerDown={(ev) => opItemNeer(ev, it, d)}
                        onClick={(ev) => { ev.stopPropagation(); if (!sleepbaar || viaTouch.current) onOpen(it) }}
                        onKeyDown={(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); onOpen(it) } }}
                        className={`absolute rounded border px-1 py-0.5 overflow-hidden text-left z-10 ${STIJL[it.bron]} ${geest?.key === it.key ? 'opacity-40' : ''} ${sleepbaar ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'} ${focusRing}`}
                        style={{ top: yVan(s, d), height: Math.max(18, yVan(e, d) - yVan(s, d)), left: `calc(${plek.baan * breed}% + 1px)`, width: `calc(${breed}% - 2px)` }}
                        title={`${it.titel} · ${uur(it.start)}–${uur(it.eind)} · ${BRON_LABEL[it.bron]}${sleepbaar ? ' · sleep om te verplaatsen' : ''}`}>
                        <div className="text-[10px] font-semibold leading-tight truncate flex items-center gap-0.5">{it.meetUrl && <Video className="h-2.5 w-2.5 shrink-0" aria-hidden />}<GsmIcoon gsm={it.gsm} /><span className="truncate">{it.titel}</span></div>
                        <div className="text-[9px] opacity-80 tabular-nums truncate">{uur(it.start)}–{uur(it.eind)}</div>
                      </button>
                    )
                  })}
                  {/* geest bij verplaatsen */}
                  {geest?.dag === d && (
                    <div className="absolute inset-x-0.5 rounded border-2 border-dashed border-gray-900 bg-white/80 pointer-events-none z-30 flex items-center justify-center"
                      style={{ top: yVan(geest.start, d), height: Math.max(18, yVan(geest.eind, d) - yVan(geest.start, d)) }}>
                      <span className="text-[10px] font-semibold">{uur(new Date(geest.start).toISOString())}–{uur(new Date(geest.eind).toISOString())}</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Maand ────────────────────────────────────────────────────────────────────

function Maand({ items, datum, onOpen, onDag }: { items: KalenderItem[]; datum: string; onOpen: (i: KalenderItem) => void; onDag: (d: string) => void }) {
  const eerste = maandagVan(`${datum.slice(0, 8)}01`)
  const dagen = Array.from({ length: 42 }, (_, i) => plusDagen(eerste, i))
  const maand = datum.slice(0, 7)
  const vandaagD = vandaag()
  const per = new Map<string, KalenderItem[]>()
  for (const it of items) { const d = dag(it.start); per.set(d, [...(per.get(d) ?? []), it]) }
  return (
    <div className="card-base !p-0 overflow-hidden">
      <div className="grid grid-cols-7 border-b border-gray-200 text-[11px] uppercase text-gray-500">
        {['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo'].map((w) => <div key={w} className="px-1.5 py-1.5 text-center">{w}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {dagen.map((d) => {
          const lijst = per.get(d) ?? []
          return (
            <div key={d} className={`min-h-[84px] sm:min-h-[104px] border-b border-r border-gray-100 p-1 ${d.slice(0, 7) !== maand ? 'bg-gray-50 text-gray-400' : ''}`}>
              <button type="button" onClick={() => onDag(d)} className={`text-xs font-semibold tabular-nums rounded px-1 ${d === vandaagD ? 'bg-gray-900 text-white' : 'hover:bg-gray-100'} ${focusRing}`} aria-label={`Week van ${datumLang(`${d}T12:00:00Z`)}`}>
                {Number(d.slice(8, 10))}
              </button>
              <div className="mt-0.5 space-y-0.5">
                {lijst.slice(0, 3).map((it) => (
                  <button key={it.key} type="button" onClick={() => onOpen(it)} className={`w-full text-left rounded border px-1 py-px text-[10px] leading-tight truncate block ${STIJL[it.bron]} ${focusRing}`} title={`${uur(it.start)} ${it.titel}`}>
                    <span className="tabular-nums">{uur(it.start)}</span> {it.titel}
                  </button>
                ))}
                {lijst.length > 3 && <button type="button" onClick={() => onDag(d)} className={`text-[10px] text-gray-600 underline underline-offset-2 ${focusRing}`}>+{lijst.length - 3} meer</button>}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Lijst ────────────────────────────────────────────────────────────────────

function Lijst({ items, onOpen }: { items: KalenderItem[]; onOpen: (i: KalenderItem) => void }) {
  if (items.length === 0) return <div className="card-base empty-state"><CalendarDays className="h-6 w-6 mx-auto mb-2 text-gray-300" aria-hidden />Geen komende meetings in deze periode.</div>
  const groepen: { d: string; items: KalenderItem[] }[] = []
  for (const it of [...items].sort((a, b) => a.start.localeCompare(b.start))) {
    const d = dag(it.start)
    const laatste = groepen[groepen.length - 1]
    if (laatste?.d === d) laatste.items.push(it); else groepen.push({ d, items: [it] })
  }
  return (
    <div className="space-y-3">
      {groepen.map((g) => (
        <section key={g.d}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5 first-letter:uppercase">{datumLang(`${g.d}T12:00:00Z`)}</h3>
          <ul className="space-y-1.5">
            {g.items.map((it) => (
              <li key={it.key}>
                <button type="button" onClick={() => onOpen(it)} className={`card-base !p-3 w-full text-left hover:border-gray-300 flex items-start gap-3 ${focusRing}`}>
                  <div className="w-24 shrink-0 text-sm tabular-nums font-medium">{uur(it.start)}–{uur(it.eind)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{it.titel}</div>
                    <div className="text-xs text-gray-600 flex items-center gap-2 flex-wrap">
                      <span className={`rounded border px-1 py-px text-[10px] font-medium ${STIJL[it.bron]}`}>{BRON_LABEL[it.bron]}</span>
                      {it.sub && <span className="truncate">{it.sub}</span>}
                      {it.meetUrl && <span className="inline-flex items-center gap-0.5"><Video className="h-3 w-3" aria-hidden />Meet</span>}
                      {it.gsm === 'ingesteld' && <span className="inline-flex items-center gap-0.5"><Bell className="h-3 w-3" aria-hidden />{GSM_MELDING_MIN} min</span>}
                      {it.gsm === 'mislukt' && <span className="inline-flex items-center gap-0.5 text-red-700"><BellOff className="h-3 w-3" aria-hidden />melding mislukt</span>}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Legenda({ week }: { week: boolean }) {
  return (
    <p className="text-[11px] text-gray-600 flex flex-wrap gap-x-3 gap-y-1 items-center">
      {week && <><span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-3 bg-white border border-emerald-300" />vrij (werkuren): sleep of tik om te plannen</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2.5 w-3 bg-niet-vrij border border-gray-300" />buiten werkuren of bezet: een interne meeting kan ook hier, met waarschuwing</span></>}
      {(Object.keys(BRON_LABEL) as KalenderBron[]).map((b) => <span key={b} className="inline-flex items-center gap-1"><span className={`inline-block h-2.5 w-3 rounded-sm border ${STIJL[b]}`} />{BRON_LABEL[b]}</span>)}
      <span className="inline-flex items-center gap-1"><Bell className="h-3 w-3" />gsm-melding {GSM_MELDING_MIN} min vooraf</span>
      <span>Tijden in Belgische tijd ({STANDAARD_TIJDZONE}).</span>
    </p>
  )
}

// ── Info over een ClickUp- of Google-afspraak ────────────────────────────────

function InfoVenster({ item, onSluit }: { item: KalenderItem; onSluit: () => void }) {
  return (
    <Modal titel={item.titel} sub={`${datumLang(item.start)}, ${uur(item.start)}–${uur(item.eind)} (Belgische tijd)`} onSluit={onSluit}>
      <dl className="text-sm divide-y divide-gray-100">
        <div className="py-2 flex gap-3"><dt className="w-28 text-xs font-medium text-gray-500 pt-0.5">Bron</dt><dd>{BRON_LABEL[item.bron]}{item.sub ? ` · ${item.sub}` : ''}</dd></div>
        {item.meetUrl && <div className="py-2 flex gap-3"><dt className="w-28 text-xs font-medium text-gray-500 pt-0.5">Google Meet</dt><dd className="min-w-0"><a href={item.meetUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 break-all">{item.meetUrl}</a></dd></div>}
        <div className="py-2 flex gap-3"><dt className="w-28 text-xs font-medium text-gray-500 pt-0.5">Gsm-melding</dt><dd>{gsmTekst(item)}</dd></div>
        {item.bron === 'afspraak' && <div className="py-2 text-gray-600">Deze verkoopafspraak bekijk en beheer je met het Verkoop-recht.</div>}
      </dl>
      {item.link && (
        <a href={item.link} target="_blank" rel="noreferrer" className={`btn-secondary w-fit ${focusRing}`}>
          {item.bron === 'clickup' ? 'Openen in ClickUp' : 'Openen in Google Agenda'}<ExternalLink className="h-4 w-4" />
        </a>
      )}
      {(item.bron === 'clickup' || item.bron === 'google') && (
        <p className="text-xs text-gray-500">{item.bron === 'clickup' ? 'Verplaatsen of wijzigen doe je in ClickUp; de agenda volgt binnen een paar minuten.' : 'Verplaatsen of wijzigen doe je in Google Agenda.'}</p>
      )}
    </Modal>
  )
}

// ── Verplaatsen na slepen: bevestigen, dan dezelfde afspraak bijwerken ──────

function VerplaatsVenster({ item, start, eind, segmenten, beschikbaar, items, onSluit, onKlaar }: {
  item: KalenderItem; start: number; eind: number; segmenten: Interval[]; beschikbaar: boolean; items: KalenderItem[]; onSluit: () => void; onKlaar: () => void
}) {
  const [bezig, setBezig] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const [serverConflict, setServerConflict] = useState<{ titel: string; start: string; eind: string }[] | null>(null)
  const nieuw = new Date(start).toISOString(), nieuwEind = new Date(eind).toISOString()
  const verkoop = item.bron === 'afspraak'
  const toekomst = start > Date.now()
  // Verkoopafspraken volgen de setterregels: enkel op wit (het eigen oude blok telt niet).
  const vrij = beschikbaar && isBookable(mergeIntervals([...segmenten, { start: Date.parse(item.start), end: Date.parse(item.eind) }]), start, eind)
  // Interne meetings: elk tijdstip mag; wat overlapt, tonen we als waarschuwing.
  const overlap = items.filter((i) => i.key !== item.key && Date.parse(i.start) < eind && start < Date.parse(i.eind))
  const conflicten = serverConflict ?? overlap.map((i) => ({ titel: i.titel, start: i.start, eind: i.eind }))
  const kan = toekomst && (verkoop ? vrij : true)
  async function bevestig() {
    setBezig(true); setFout(null)
    try {
      if (verkoop) {
        await api('/api/admin/sales/appointments', { method: 'PATCH', body: JSON.stringify({ id: item.id, startsAt: start, endsAt: eind }) })
      } else {
        const tz = item.tijdzone || STANDAARD_TIJDZONE
        await api(`/api/admin/meetings/${item.id}`, {
          method: 'PATCH',
          body: JSON.stringify({
            actie: 'wijzig', dag: dag(nieuw, tz), uur: uur(nieuw, tz), duur_minuten: Math.round((eind - start) / MIN), tijdzone: tz,
            // Gezien en toch bevestigd = bewust; anders kijkt de server vlak voor het opslaan nog eens.
            controleer_vrij: true, toch_conflict: conflicten.length > 0,
          }),
        })
      }
      toast.success('Verplaatst. Google Agenda, ClickUp, de uitnodiging en de herinneringen zijn bijgewerkt.')
      onKlaar()
    } catch (e) {
      const data = (e as { data?: { conflict?: boolean; conflicten?: { titel: string; start: string; eind: string }[] } }).data
      if (data?.conflict) { setServerConflict(data.conflicten ?? []); setFout(`${e instanceof Error ? e.message : 'Er staat al iets op dit moment.'}`) }
      else setFout(e instanceof Error ? e.message : 'Verplaatsen mislukt')
    } finally { setBezig(false) }
  }
  return (
    <Modal titel="Meeting verplaatsen?" sub={item.titel} onSluit={onSluit}
      voet={<>
        <button type="button" onClick={onSluit} className={`btn-secondary ${focusRing}`}><X className="h-4 w-4" />Niet verplaatsen</button>
        <button type="button" onClick={bevestig} disabled={bezig || !kan} className={`btn-primary ${focusRing}`}>{bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{!verkoop && conflicten.length ? 'Toch verplaatsen' : 'Verplaatsen'}</button>
      </>}>
      <div className="flex items-center gap-2 text-sm flex-wrap">
        <span className="line-through text-gray-500">{datumKort(item.start)} {uur(item.start)}–{uur(item.eind)}</span>
        <MoveRight className="h-4 w-4" aria-hidden />
        <span className="font-semibold">{datumKort(nieuw)} {uur(nieuw)}–{uur(nieuwEind)}</span>
      </div>
      <p className="text-sm text-gray-700">Dezelfde afspraak wordt bijgewerkt: Google Agenda (de Meet-link blijft), de uitnodiging aan de deelnemers, ClickUp en de herinneringen. Er komt geen tweede afspraak bij.</p>
      {!toekomst && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">Dit moment ligt in het verleden.</p>}
      {toekomst && verkoop && !vrij && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="alert">Een verkoopafspraak verplaats je naar een wit (vrij) moment binnen de werkuren.</p>}
      {toekomst && !verkoop && conflicten.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 space-y-1" role="alert">
          <p className="font-medium">Er staat al iets op dit moment:</p>
          <ul className="list-disc pl-5">{conflicten.map((c, i) => <li key={i}>{c.titel} · {uur(c.start)}–{uur(c.eind)}</li>)}</ul>
          <p className="text-xs">Intern mag je op elk tijdstip plannen. Bevestig om toch te verplaatsen.</p>
        </div>
      )}
      {fout && !serverConflict && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{fout} Er is niets gewijzigd.</p>}
    </Modal>
  )
}
