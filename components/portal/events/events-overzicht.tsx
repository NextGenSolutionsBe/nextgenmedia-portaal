'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { ArrowRight, CalendarDays, Check, MapPin, Monitor, Ticket, Video } from 'lucide-react'
import { EVENT_SOORTEN, SOORT_LABEL, inschrijvingOpen, prijsTekst, type EventSoort } from '@/lib/events'
import type { PortaalEvent } from '@/lib/events-server'
import { AftelBlokken, AftelLabel, EventKaart, Omslag, dagLang, dagNr, hoofdletter, maandKort, plaatsKort, uurKort, useNu } from './events-ui'

export function EventsOverzicht({ events }: { events: PortaalEvent[] }) {
  const [soort, setSoort] = useState<EventSoort | 'alle'>('alle')
  const [toonVoorbij, setToonVoorbij] = useState(false)
  const nu = useNu(60_000) ?? 0

  const { komend, voorbij, mijn } = useMemo(() => {
    const k = events.filter((e) => e.status === 'gepubliceerd' && (nu === 0 || Date.parse(e.einde_op) > nu))
    const v = events.filter((e) => !k.includes(e)).sort((a, b) => b.start_op.localeCompare(a.start_op))
    return { komend: k, voorbij: v, mijn: k.filter((e) => e.mijn.length > 0) }
  }, [events, nu])
  const soorten = EVENT_SOORTEN.filter((s) => komend.some((e) => e.soort === s))
  const gefilterd = komend.filter((e) => soort === 'alle' || e.soort === soort)
  // Uitgelicht: het eerstvolgende event waarvoor je nog kan inschrijven en nog niet ingeschreven bent.
  const uitgelicht = gefilterd.find((e) => e.mijn.length === 0 && inschrijvingOpen(e, e.bezet).open) ?? null
  const rest = gefilterd.filter((e) => e !== uitgelicht)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Ticket className="h-6 w-6" />Workshops & events</h1>
        <p className="text-sm text-gray-500 mt-1">Webinars, workshops en opleidingen van het team van NextGenMedia. Inschrijven duurt tien seconden.</p>
      </div>

      {mijn.length > 0 && (
        <section aria-label="Jij gaat naar">
          <h2 className="text-sm font-semibold text-gray-700 mb-2">Jij gaat naar</h2>
          <div className="flex gap-3 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">
            {mijn.map((e) => (
              <Link key={e.id} href={`/portal/events/${e.id}`} className="shrink-0 w-[260px] sm:w-[300px] rounded-2xl bg-gray-900 text-white p-4 flex gap-3 hover:bg-gray-800">
                <div className="w-12 shrink-0 rounded-xl bg-white text-gray-900 text-center py-1.5 h-fit">
                  <div className="text-lg font-bold leading-none">{dagNr(e.start_op)}</div>
                  <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-0.5">{maandKort(e.start_op)}</div>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-sm font-semibold line-clamp-2">{e.titel}</div>
                  <div className="text-xs text-gray-300">{uurKort(e.start_op)} · {plaatsKort(e)}</div>
                  <div className="flex items-center gap-2 text-xs">
                    <AftelLabel start={e.start_op} einde={e.einde_op} className="rounded-full bg-white/15 px-2 py-0.5 font-medium" />
                    {e.meet_url && <span className="inline-flex items-center gap-1 text-green-300"><Video className="h-3 w-3" />Meet</span>}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {soorten.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto no-scrollbar -mx-4 px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Soort">
          {(['alle', ...soorten] as const).map((s) => (
            <button key={s} type="button" role="tab" aria-selected={soort === s} onClick={() => setSoort(s)}
              className={`shrink-0 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium border transition-colors ${soort === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'}`}>
              {s === 'alle' ? 'Alles' : SOORT_LABEL[s].meer}
              <span className={`ml-1.5 text-xs tabular-nums ${soort === s ? 'text-gray-300' : 'text-gray-400'}`}>{s === 'alle' ? komend.length : komend.filter((e) => e.soort === s).length}</span>
            </button>
          ))}
        </div>
      )}

      {komend.length === 0 && (
        <div className="rounded-2xl border border-dashed border-gray-300 bg-white p-8 text-center">
          <CalendarDays className="h-8 w-8 mx-auto text-gray-300" />
          <p className="mt-2 font-medium">Er staat nu niets gepland</p>
          <p className="text-sm text-gray-500">Nieuwe webinars en workshops verschijnen hier zodra ze ingepland zijn.</p>
        </div>
      )}

      {uitgelicht && (
        <Link href={`/portal/events/${uitgelicht.id}`} className="group relative block rounded-3xl overflow-hidden min-h-[360px] sm:min-h-[340px]">
          <div className="absolute inset-0"><Omslag e={uitgelicht} className="group-hover:scale-[1.02] transition-transform duration-500" /></div>
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/50 to-black/10" />
          <div className="relative h-full min-h-[360px] sm:min-h-[340px] flex flex-col justify-end p-5 sm:p-8 text-white gap-3">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="rounded-full bg-white text-gray-900 font-semibold px-2.5 py-1">Eerstvolgende {SOORT_LABEL[uitgelicht.soort].enkel.toLowerCase()}</span>
              <span className="rounded-full bg-white/15 backdrop-blur px-2.5 py-1">{prijsTekst(uitgelicht.prijs_cents)}</span>
              {uitgelicht.capaciteit != null && <span className="rounded-full bg-white/15 backdrop-blur px-2.5 py-1">Nog {Math.max(0, uitgelicht.capaciteit - uitgelicht.bezet)} plaatsen</span>}
            </div>
            <h2 className="text-2xl sm:text-3xl font-bold leading-tight max-w-2xl text-white">{uitgelicht.titel}</h2>
            {uitgelicht.samenvatting && <p className="text-sm sm:text-base text-white/80 max-w-xl line-clamp-2">{uitgelicht.samenvatting}</p>}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/80">
              <span className="inline-flex items-center gap-1.5"><CalendarDays className="h-4 w-4" />{hoofdletter(dagLang(uitgelicht.start_op))} · {uurKort(uitgelicht.start_op)}</span>
              <span className="inline-flex items-center gap-1.5">{uitgelicht.vorm === 'online' ? <Monitor className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}{plaatsKort(uitgelicht)}</span>
            </div>
            <div className="flex flex-wrap items-end justify-between gap-3 pt-1">
              <AftelBlokken start={uitgelicht.start_op} einde={uitgelicht.einde_op} licht />
              <span className="inline-flex items-center gap-2 rounded-xl bg-white text-gray-900 font-semibold px-5 py-3 group-hover:gap-3 transition-all">Inschrijven<ArrowRight className="h-4 w-4" /></span>
            </div>
          </div>
        </Link>
      )}

      {rest.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rest.map((e) => <EventKaart key={e.id} e={e} />)}
        </div>
      )}

      {voorbij.length > 0 && (
        <section>
          <button type="button" onClick={() => setToonVoorbij((v) => !v)} className="text-sm text-gray-500 underline">
            {toonVoorbij ? 'Verberg' : 'Toon'} afgelopen events ({voorbij.length})
          </button>
          {toonVoorbij && (
            <ul className="mt-3 divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white">
              {voorbij.map((e) => (
                <li key={e.id}>
                  <Link href={`/portal/events/${e.id}`} className="flex items-center gap-3 p-3 hover:bg-gray-50">
                    <span className="w-10 text-center text-xs text-gray-500"><b className="block text-base text-gray-800">{dagNr(e.start_op)}</b>{maandKort(e.start_op)}</span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium truncate">{e.titel}</span>
                      <span className="block text-xs text-gray-500">{SOORT_LABEL[e.soort].enkel}{e.status === 'geannuleerd' ? ' · geannuleerd' : ''}</span>
                    </span>
                    {e.mijn.length > 0 && e.status !== 'geannuleerd' && <span className="inline-flex items-center gap-1 text-xs text-green-700"><Check className="h-3.5 w-3.5" />Was erbij</span>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
