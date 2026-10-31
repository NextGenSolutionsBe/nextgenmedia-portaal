'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, Check, GraduationCap, MapPin, Monitor, Presentation, Sparkles, Users, Video } from 'lucide-react'
import { aftelling, coverUrl, inschrijvingOpen, prijsTekst, SOORT_LABEL, DICHT_LABEL, type EventSoort } from '@/lib/events'
import type { PortaalEvent } from '@/lib/events-server'

export const SOORT_ICOON: Record<EventSoort, React.ElementType> = { webinar: Video, workshop: Presentation, event: Sparkles, opleiding: GraduationCap }

const tz = 'Europe/Brussels'
export const dagNr = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { timeZone: tz, day: 'numeric' })
export const maandKort = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { timeZone: tz, month: 'short' }).replace('.', '')
export const uurKort = (iso: string) => new Date(iso).toLocaleTimeString('nl-BE', { timeZone: tz, hour: '2-digit', minute: '2-digit' })
export const dagLang = (iso: string) => new Date(iso).toLocaleDateString('nl-BE', { timeZone: tz, weekday: 'long', day: 'numeric', month: 'long' })
/** Enkel de eerste letter groot ("Maandag 30 november"); CSS-capitalize zou ook de maand groot zetten. */
export const hoofdletter = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)
export const plaatsKort = (e: Pick<PortaalEvent, 'vorm' | 'locatie'>) => (e.vorm === 'online' ? 'Online' : (e.locatie ?? '').split(',').pop()?.trim() || 'Op locatie')

/** Huidige tijd die meetikt; null tot na het laden (geen verschil tussen server en browser). */
export function useNu(stapMs: number): number | null {
  const [nu, setNu] = useState<number | null>(null)
  useEffect(() => {
    setNu(Date.now())
    const t = setInterval(() => setNu(Date.now()), stapMs)
    return () => clearInterval(t)
  }, [stapMs])
  return nu
}

/** Grote aftelling in blokken (dagen, uren, minuten, seconden). */
export function AftelBlokken({ start, einde, licht }: { start: string; einde: string; licht?: boolean }) {
  const nu = useNu(1000)
  if (nu === null) return <div className="h-[62px]" aria-hidden />
  const a = aftelling(start, einde, nu)
  if (a.fase !== 'komend') {
    return <div className={`inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${a.fase === 'bezig' ? 'bg-green-500 text-white' : licht ? 'bg-white/15 text-white' : 'bg-gray-100 text-gray-600'}`}>{a.fase === 'bezig' && <span className="h-2 w-2 rounded-full bg-white animate-pulse" />}{a.tekst}</div>
  }
  const blokken: [number, string][] = [[a.dagen, a.dagen === 1 ? 'dag' : 'dagen'], [a.uren, 'uur'], [a.minuten, 'min'], [a.seconden, 'sec']]
  return (
    <div className="flex gap-2" role="timer" aria-label={a.tekst}>
      {blokken.map(([w, l]) => (
        <div key={l} className={`min-w-[56px] rounded-xl px-2 py-2 text-center ${licht ? 'bg-white/15 text-white backdrop-blur' : 'bg-gray-900 text-white'}`}>
          <div className="text-xl sm:text-2xl font-bold tabular-nums leading-none">{String(w).padStart(2, '0')}</div>
          <div className={`text-[10px] uppercase tracking-wide mt-1 ${licht ? 'text-white/70' : 'text-gray-400'}`}>{l}</div>
        </div>
      ))}
    </div>
  )
}

/** "Nog 12 dagen" als klein label. */
export function AftelLabel({ start, einde, className = '' }: { start: string; einde: string; className?: string }) {
  const nu = useNu(30_000)
  if (nu === null) return null
  const a = aftelling(start, einde, nu)
  return <span className={className}>{a.tekst}</span>
}

export function Omslag({ e, className = '' }: { e: Pick<PortaalEvent, 'cover_pad' | 'soort' | 'titel'>; className?: string }) {
  const url = coverUrl(e)
  const Icoon = SOORT_ICOON[e.soort]
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt="" loading="lazy" className={`w-full h-full object-cover ${className}`} />
  }
  return (
    <div className={`w-full h-full bg-gradient-to-br from-gray-900 via-gray-800 to-gray-600 flex items-center justify-center ${className}`}>
      <Icoon className="h-12 w-12 text-white/25" strokeWidth={1.5} />
    </div>
  )
}

export function EventKaart({ e }: { e: PortaalEvent }) {
  const open = inschrijvingOpen(e, e.bezet)
  const ingeschreven = e.mijn.length > 0
  const vrij = e.capaciteit != null ? e.capaciteit - e.bezet : null
  return (
    <Link href={`/portal/events/${e.id}`} className="group flex flex-col rounded-2xl border border-gray-200 bg-white overflow-hidden hover:border-gray-300 hover:shadow-md transition-shadow">
      <div className="relative aspect-[16/9] overflow-hidden">
        <Omslag e={e} className="group-hover:scale-[1.02] transition-transform duration-300" />
        <div className="absolute top-3 left-3 rounded-xl bg-white/95 text-center px-2.5 py-1.5 shadow-sm">
          <div className="text-lg font-bold leading-none">{dagNr(e.start_op)}</div>
          <div className="text-[10px] uppercase tracking-wide text-gray-500 mt-0.5">{maandKort(e.start_op)}</div>
        </div>
        <span className="absolute top-3 right-3 rounded-full bg-black/60 text-white text-[11px] font-medium px-2.5 py-1 backdrop-blur">{SOORT_LABEL[e.soort].enkel}</span>
        {ingeschreven && <span className="absolute bottom-3 left-3 inline-flex items-center gap-1 rounded-full bg-green-500 text-white text-[11px] font-semibold px-2.5 py-1"><Check className="h-3 w-3" />Ingeschreven</span>}
      </div>
      <div className="flex-1 flex flex-col p-4 gap-2">
        <h3 className="font-semibold leading-snug line-clamp-2">{e.titel}</h3>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{uurKort(e.start_op)}–{uurKort(e.einde_op)}</span>
          <span className="inline-flex items-center gap-1">{e.vorm === 'online' ? <Monitor className="h-3.5 w-3.5" /> : <MapPin className="h-3.5 w-3.5" />}{plaatsKort(e)}</span>
        </div>
        {e.samenvatting && <p className="text-sm text-gray-600 line-clamp-2">{e.samenvatting}</p>}
        <div className="mt-auto pt-2 flex items-center justify-between gap-2 text-sm">
          <span className="font-semibold">{prijsTekst(e.prijs_cents)}</span>
          {e.status === 'geannuleerd' ? <span className="text-xs font-medium text-red-600">Geannuleerd</span>
            : !open.open ? <span className="text-xs font-medium text-gray-500">{DICHT_LABEL[open.reden]}</span>
            : <span className="inline-flex items-center gap-1.5 text-xs">
                {vrij != null && vrij <= 5 && <span className="inline-flex items-center gap-1 text-amber-700 font-medium"><Users className="h-3.5 w-3.5" />Nog {vrij}</span>}
                <AftelLabel start={e.start_op} einde={e.einde_op} className="rounded-full bg-gray-100 px-2 py-0.5 font-medium text-gray-700" />
              </span>}
        </div>
      </div>
    </Link>
  )
}
