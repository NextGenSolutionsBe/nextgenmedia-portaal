'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Ban, CalendarPlus, Copy, Loader2, MapPin, Monitor, Plus, RefreshCw, Send, Trash2, Users, X } from 'lucide-react'
import { Bevestig } from '@/app/admin/instellingen/ui'
import { EventFormulier, leegFormulier, type Formulier } from './event-formulier'
import { EventInschrijvingen, type InschrijvingRij } from './event-inschrijvingen'
import { SOORT_LABEL, euro, naarFormulier, prijsTekst, wanneerTekst, aftelling, type KlantEvent } from '@/lib/events'

type Agenda = { id: string; naam: string; gekoppeld: boolean }
type Rij = KlantEvent & { ingeschreven: number; te_factureren: { aantal: number; cents: number } }
type Tab = 'komend' | 'concept' | 'afgelopen' | 'geannuleerd'

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { cache: 'no-store', ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) } })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(j.error || 'Mislukt'), { body: j })
  return j as T
}

const tabVan = (e: KlantEvent, nu: number): Tab =>
  e.status === 'geannuleerd' ? 'geannuleerd' : e.status === 'concept' ? 'concept' : Date.parse(e.einde_op) < nu ? 'afgelopen' : 'komend'
const dagNr = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels', day: 'numeric' })
const maandKort = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { timeZone: 'Europe/Brussels', month: 'short' }).replace('.', '')

export function EventsAdmin({ magToevoegen, magAanpassen, magVerwijderen }: { magToevoegen: boolean; magAanpassen: boolean; magVerwijderen: boolean }) {
  const [rijen, setRijen] = useState<Rij[] | null>(null)
  const [agendas, setAgendas] = useState<Agenda[]>([])
  const [standaard, setStandaard] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('komend')
  const [open, setOpen] = useState<{ id: string | null; kopie?: Formulier } | null>(null)

  const laad = useCallback(async () => {
    try {
      const j = await api<{ events: Rij[]; agendas: Agenda[]; standaardAgenda: string | null }>('/api/admin/events')
      setRijen(j.events); setAgendas(j.agendas); setStandaard(j.standaardAgenda)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt'); setRijen([]) }
  }, [])
  useEffect(() => { laad() }, [laad])
  // Deep-link vanuit een melding: /admin/events?event=<id>
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('event')
    if (id && /^[0-9a-f-]{36}$/i.test(id)) setOpen({ id })
  }, [])

  const nu = Date.now()
  const perTab = useMemo(() => {
    const m: Record<Tab, Rij[]> = { komend: [], concept: [], afgelopen: [], geannuleerd: [] }
    for (const r of rijen ?? []) m[tabVan(r, nu)].push(r)
    m.komend.sort((a, b) => a.start_op.localeCompare(b.start_op))
    m.concept.sort((a, b) => a.start_op.localeCompare(b.start_op))
    return m
  }, [rijen, nu])
  const teFact = (rijen ?? []).reduce((s, r) => ({ aantal: s.aantal + r.te_factureren.aantal, cents: s.cents + r.te_factureren.cents }), { aantal: 0, cents: 0 })
  const lijst = perTab[tab]

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {magToevoegen && <button type="button" onClick={() => setOpen({ id: null })} className="btn-primary"><Plus className="h-4 w-4" />Nieuw event</button>}
        {teFact.aantal > 0 && (
          <span className="text-sm text-gray-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            Nog te factureren: <b>{teFact.aantal}</b> {teFact.aantal === 1 ? 'inschrijving' : 'inschrijvingen'} · {euro(teFact.cents)} excl. btw
          </span>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1" role="tablist">
        {([['komend', 'Komend'], ['concept', 'Concepten'], ['afgelopen', 'Afgelopen'], ['geannuleerd', 'Geannuleerd']] as const).map(([k, l]) => (
          <button key={k} role="tab" aria-selected={tab === k} type="button" onClick={() => setTab(k)}
            className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-medium border ${tab === k ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'}`}>
            {l} <span className={`ml-0.5 tabular-nums text-xs ${tab === k ? 'text-gray-300' : 'text-gray-400'}`}>{perTab[k].length}</span>
          </button>
        ))}
      </div>

      {rijen === null ? <div className="card-base flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        : lijst.length === 0 ? (
          <div className="card-base text-sm text-gray-500 flex flex-col items-start gap-2">
            {tab === 'komend' ? 'Geen komende events. Plan er een in; klanten zien het meteen na publiceren.' : tab === 'concept' ? 'Geen concepten.' : tab === 'afgelopen' ? 'Nog geen afgelopen events.' : 'Geen geannuleerde events.'}
          </div>
        ) : (
          <ul className="space-y-2">
            {lijst.map((r) => {
              const a = aftelling(r.start_op, r.einde_op, nu)
              const vol = r.capaciteit ? Math.min(100, Math.round((r.ingeschreven / r.capaciteit) * 100)) : null
              return (
                <li key={r.id}>
                  <button type="button" onClick={() => setOpen({ id: r.id })} className="card-base !p-3 w-full text-left flex items-start gap-3 hover:border-gray-300">
                    <div className="w-12 shrink-0 rounded-xl bg-gray-900 text-white text-center py-1.5">
                      <div className="text-lg font-bold leading-none">{dagNr(r.start_op)}</div>
                      <div className="text-[10px] uppercase tracking-wide text-gray-300 mt-0.5">{maandKort(r.start_op)}</div>
                    </div>
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">{SOORT_LABEL[r.soort].enkel}</span>
                        {r.status === 'concept' && <span className="status-badge bg-gray-100 text-gray-600">Concept</span>}
                        {r.status === 'geannuleerd' && <span className="status-badge bg-red-50 text-red-700">Geannuleerd</span>}
                        {r.status === 'gepubliceerd' && a.fase !== 'voorbij' && <span className="status-badge bg-green-50 text-green-700">{a.tekst}</span>}
                        {r.google_status === 'fout' && r.status !== 'geannuleerd' && <span className="status-badge bg-amber-50 text-amber-800"><AlertTriangle className="h-3 w-3" />Google</span>}
                      </div>
                      <div className="font-medium text-sm truncate">{r.titel}</div>
                      <div className="text-xs text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span>{wanneerTekst(r)}</span>
                        <span className="inline-flex items-center gap-1">{r.vorm === 'online' ? <Monitor className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}{r.vorm === 'online' ? 'Online' : (r.locatie ?? '').split(',').pop()?.trim() || 'Op locatie'}</span>
                        <span>{prijsTekst(r.prijs_cents)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-600">
                        <Users className="h-3.5 w-3.5 text-gray-400" />
                        <span className="tabular-nums">{r.ingeschreven}{r.capaciteit ? ` / ${r.capaciteit}` : ''} ingeschreven</span>
                        {vol !== null && <span className="h-1.5 w-20 rounded-full bg-gray-100 overflow-hidden"><span className="block h-full bg-gray-900" style={{ width: `${vol}%` }} /></span>}
                        {r.te_factureren.aantal > 0 && <span className="text-amber-800">· {r.te_factureren.aantal} te factureren</span>}
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}

      {open && (
        <EventPaneel
          id={open.id} kopie={open.kopie} agendas={agendas} standaard={standaard}
          magAanpassen={open.id ? magAanpassen : magToevoegen} magVerwijderen={magVerwijderen} magToevoegen={magToevoegen}
          onSluit={() => setOpen(null)}
          onGewijzigd={(id) => { laad(); if (id) setOpen({ id }) }}
          onDupliceer={(f) => setOpen({ id: null, kopie: f })}
          onWeg={() => { setOpen(null); laad() }}
        />
      )}
    </div>
  )
}

// ── Zijpaneel: één event ─────────────────────────────────────────────────────

function EventPaneel({ id, kopie, agendas, standaard, magAanpassen, magVerwijderen, magToevoegen, onSluit, onGewijzigd, onDupliceer, onWeg }: {
  id: string | null; kopie?: Formulier; agendas: Agenda[]; standaard: string | null
  magAanpassen: boolean; magVerwijderen: boolean; magToevoegen: boolean
  onSluit: () => void; onGewijzigd: (id: string | null) => void; onDupliceer: (f: Formulier) => void; onWeg: () => void
}) {
  const [event, setEvent] = useState<KlantEvent | null>(null)
  const [rijen, setRijen] = useState<InschrijvingRij[]>([])
  const [f, setF] = useState<Formulier>(() => kopie ?? leegFormulier(standaard))
  const [origineel, setOrigineel] = useState<string>('')
  const [tab, setTab] = useState<'gegevens' | 'inschrijvingen'>('gegevens')
  const [bezig, setBezig] = useState<string | null>(null)
  const [vraag, setVraag] = useState<null | 'annuleer' | 'verwijder' | 'wijziging'>(null)
  const [laden, setLaden] = useState(!!id)

  const laad = useCallback(async () => {
    if (!id) return
    try {
      const j = await api<{ event: KlantEvent; inschrijvingen: InschrijvingRij[] }>(`/api/admin/events/${id}`)
      setEvent(j.event); setRijen(j.inschrijvingen)
      const form = naarFormulier(j.event) as unknown as Formulier
      setF(form); setOrigineel(JSON.stringify(form))
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Laden mislukt') }
    finally { setLaden(false) }
  }, [id])
  useEffect(() => { laad() }, [laad])

  const zet = (patch: Partial<Formulier>) => setF((x) => ({ ...x, ...patch }))
  const gewijzigd = JSON.stringify(f) !== origineel
  const actief = rijen.filter((r) => r.status === 'ingeschreven').length
  const geannuleerd = event?.status === 'geannuleerd'
  const tijdOfPlaatsAnders = !!event && ((() => {
    const o = JSON.parse(origineel || '{}') as Partial<Formulier>
    return o.datum !== f.datum || o.start !== f.start || o.einde !== f.einde || (o.einddatum || o.datum) !== (f.einddatum || f.datum) || o.vorm !== f.vorm || (o.locatie ?? '') !== f.locatie || o.titel !== f.titel
  })())

  const verstuur = async (actie: 'nieuw' | 'bewaar' | 'bewaar_en_publiceer' | 'nieuw_en_publiceer') => {
    setBezig(actie)
    try {
      if (actie === 'nieuw' || actie === 'nieuw_en_publiceer') {
        const j = await api<{ event: KlantEvent }>('/api/admin/events', { method: 'POST', body: JSON.stringify(f) })
        if (actie === 'nieuw_en_publiceer') {
          try {
            const p = await api<{ event: KlantEvent; waarschuwing: string | null }>(`/api/admin/events/${j.event.id}`, { method: 'PATCH', body: JSON.stringify({ actie: 'publiceer' }) })
            if (p.waarschuwing) toast.warning(p.waarschuwing); else toast.success('Gepubliceerd. Klanten zien het nu in de klantapp.')
          } catch (e) { toast.error(`Bewaard als concept. ${e instanceof Error ? e.message : ''}`) }
        } else toast.success('Bewaard als concept.')
        onGewijzigd(j.event.id)
        return
      }
      const j = await api<{ event: KlantEvent; waarschuwing: string | null; verwittigd?: boolean }>(`/api/admin/events/${id}`, { method: 'PATCH', body: JSON.stringify({ ...f, actie }) })
      if (j.waarschuwing) toast.warning(j.waarschuwing)
      else toast.success(actie === 'bewaar_en_publiceer' ? 'Gepubliceerd. Klanten zien het nu in de klantapp.' : j.verwittigd ? 'Bewaard. Google stuurt de ingeschrevenen de wijziging.' : 'Bewaard.')
      await laad(); onGewijzigd(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
    finally { setBezig(null); setVraag(null) }
  }
  const actie = async (a: 'annuleer' | 'google_opnieuw', ok: string) => {
    setBezig(a)
    try {
      const j = await api<{ event: KlantEvent; waarschuwing?: string | null }>(`/api/admin/events/${id}`, { method: 'PATCH', body: JSON.stringify({ actie: a }) })
      if (j.waarschuwing) toast.warning(j.waarschuwing); else toast.success(ok)
      await laad(); onGewijzigd(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt'); await laad() }
    finally { setBezig(null); setVraag(null) }
  }
  const verwijder = async () => {
    setBezig('verwijder')
    try { await api(`/api/admin/events/${id}`, { method: 'DELETE' }); toast.success('Concept verwijderd.'); onWeg() }
    catch (e) { toast.error(e instanceof Error ? e.message : 'Mislukt') }
    finally { setBezig(null); setVraag(null) }
  }
  const sluit = () => { if (gewijzigd && !window.confirm('Je wijzigingen zijn niet bewaard. Toch sluiten?')) return; onSluit() }
  const kopieerMeet = async () => { try { await navigator.clipboard.writeText(event?.meet_url ?? ''); toast.success('Meet-link gekopieerd.') } catch { /* niets */ } }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/20" onMouseDown={(e) => { if (e.target === e.currentTarget) sluit() }}>
      <aside className="h-full w-full sm:max-w-xl bg-white shadow-2xl flex flex-col" aria-label="Event">
        <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
          <div className="min-w-0">
            <div className="text-[11px] text-gray-500">{id ? (event ? `${SOORT_LABEL[event.soort].enkel} · ${event.status === 'concept' ? 'concept' : event.status === 'geannuleerd' ? 'geannuleerd' : 'gepubliceerd'}` : '') : kopie ? 'Kopie' : 'Nieuw event'}</div>
            <h2 className="font-semibold truncate">{id ? (event?.titel ?? '…') : (f.titel || 'Nieuw event')}</h2>
          </div>
          <button type="button" onClick={sluit} className="h-9 w-9 shrink-0 flex items-center justify-center rounded-lg hover:bg-gray-100" aria-label="Sluiten"><X className="h-4 w-4" /></button>
        </div>
        {id && (
          <div className="flex gap-1 px-4 pt-3" role="tablist">
            {([['gegevens', 'Gegevens'], ['inschrijvingen', `Inschrijvingen (${actief})`]] as const).map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium ${tab === k ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{l}</button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {laden ? <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div> : tab === 'inschrijvingen' && event ? (
            <EventInschrijvingen event={event} rijen={rijen} magAanpassen={magAanpassen} onWijziging={laad} />
          ) : (
            <>
              {event && event.status !== 'concept' && (
                <div className={`rounded-xl border p-3 text-sm space-y-1.5 ${event.google_status === 'fout' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-gray-50'}`}>
                  {event.google_status === 'ok' && (
                    <>
                      <div className="flex items-center gap-2 font-medium"><CalendarPlus className="h-4 w-4 text-gray-500" />In de Google-agenda</div>
                      {event.meet_url && (
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <a href={event.meet_url} target="_blank" rel="noreferrer" className="underline break-all">{event.meet_url}</a>
                          <button type="button" onClick={kopieerMeet} className="inline-flex items-center gap-1 text-gray-600 hover:text-black"><Copy className="h-3 w-3" />Kopieer</button>
                        </div>
                      )}
                    </>
                  )}
                  {event.google_status === 'fout' && (
                    <>
                      <div className="flex items-center gap-2 font-medium text-amber-900"><AlertTriangle className="h-4 w-4" />Google-agenda lukte niet</div>
                      <p className="text-xs text-amber-900">{event.google_fout}</p>
                      {magAanpassen && !geannuleerd && <button type="button" onClick={() => actie('google_opnieuw', 'Google-agenda in orde.')} disabled={!!bezig} className="btn-secondary text-xs">{bezig === 'google_opnieuw' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Opnieuw proberen</button>}
                    </>
                  )}
                  {event.google_status === 'geannuleerd' && <div className="flex items-center gap-2 text-gray-600"><Ban className="h-4 w-4" />Geannuleerd in Google; de gasten kregen een bericht van Google.</div>}
                </div>
              )}
              <fieldset disabled={!magAanpassen || geannuleerd} className="disabled:opacity-70">
                <EventFormulier f={f} zet={zet} agendas={agendas} agendaVast={!!event && event.status !== 'concept'} gepubliceerd={event?.status === 'gepubliceerd'} />
              </fieldset>
            </>
          )}
        </div>

        {/* Knoppen */}
        {tab === 'gegevens' && !laden && (
          <div className="border-t border-gray-100 px-4 py-3 flex flex-wrap items-center gap-2">
            {!id && magAanpassen && (
              <>
                <button type="button" onClick={() => verstuur('nieuw_en_publiceer')} disabled={!!bezig} className="btn-primary">{bezig === 'nieuw_en_publiceer' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Publiceren</button>
                <button type="button" onClick={() => verstuur('nieuw')} disabled={!!bezig} className="btn-secondary">{bezig === 'nieuw' && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren als concept</button>
              </>
            )}
            {event?.status === 'concept' && magAanpassen && (
              <>
                <button type="button" onClick={() => verstuur('bewaar_en_publiceer')} disabled={!!bezig} className="btn-primary">{bezig === 'bewaar_en_publiceer' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}Publiceren</button>
                <button type="button" onClick={() => verstuur('bewaar')} disabled={!!bezig || !gewijzigd} className="btn-secondary">{bezig === 'bewaar' && <Loader2 className="h-4 w-4 animate-spin" />}Bewaren</button>
              </>
            )}
            {event?.status === 'gepubliceerd' && magAanpassen && (
              <button type="button" onClick={() => (tijdOfPlaatsAnders && actief > 0 ? setVraag('wijziging') : verstuur('bewaar'))} disabled={!!bezig || !gewijzigd} className="btn-primary">
                {bezig === 'bewaar' && <Loader2 className="h-4 w-4 animate-spin" />}Wijzigingen bewaren
              </button>
            )}
            <div className="ml-auto flex items-center gap-1">
              {event && magToevoegen && (
                <button type="button" onClick={() => onDupliceer({ ...f, datum: '', einddatum: '', inschrijven_tot: '' })} className="btn-secondary text-sm" title="Dupliceren (bv. dezelfde workshop op een andere datum)" aria-label="Dupliceren"><Copy className="h-4 w-4" /><span className="hidden sm:inline">Dupliceren</span></button>
              )}
              {event?.status === 'gepubliceerd' && magAanpassen && (
                <button type="button" onClick={() => setVraag('annuleer')} className="btn-danger text-sm" aria-label="Event annuleren"><Ban className="h-4 w-4" /><span className="hidden sm:inline">Annuleren</span></button>
              )}
              {event?.status === 'concept' && magVerwijderen && (
                <button type="button" onClick={() => setVraag('verwijder')} className="btn-danger text-sm" aria-label="Concept verwijderen"><Trash2 className="h-4 w-4" /></button>
              )}
            </div>
          </div>
        )}
      </aside>

      {vraag === 'annuleer' && event && (
        <Bevestig titel="Event annuleren" gevaarlijk bevestigLabel="Event annuleren" bezig={bezig === 'annuleer'}
          tekst={<>"{event.titel}" verdwijnt uit de klantapp en de herinneringen vervallen. {actief > 0 ? <><b>Google stuurt de {actief} ingeschrevenen een annulering.</b> Facturen voor dit event maak je dan niet.</> : 'Er is nog niemand ingeschreven.'}</>}
          onAnnuleer={() => setVraag(null)} onBevestig={() => actie('annuleer', 'Event geannuleerd.')} />
      )}
      {vraag === 'verwijder' && (
        <Bevestig titel="Concept verwijderen" gevaarlijk bevestigLabel="Verwijderen" bezig={bezig === 'verwijder'}
          tekst="Dit concept is nog niet gepubliceerd. Het verdwijnt definitief." onAnnuleer={() => setVraag(null)} onBevestig={verwijder} />
      )}
      {vraag === 'wijziging' && (
        <Bevestig titel="Ingeschrevenen verwittigen" bevestigLabel="Bewaren en verwittigen" bezig={bezig === 'bewaar'}
          tekst={<>Je wijzigt de titel, de tijd of de plaats. <b>Google stuurt de {actief} ingeschrevenen een bijgewerkte uitnodiging.</b></>}
          onAnnuleer={() => setVraag(null)} onBevestig={() => verstuur('bewaar')} />
      )}
    </div>
  )
}
