import Link from 'next/link'
import { ArrowRight, CalendarDays, Clapperboard, FolderUp, Lightbulb, Sparkles, Ticket, Video } from 'lucide-react'
import { HeroKaart, type FeedItem } from '@/components/nieuws/nieuws-kaart'
import { AftelLabel } from '@/components/portal/events/events-ui'
import { publiekeUrl } from '@/lib/marketing-media'
import { prijsTekst } from '@/lib/events'
import type { Partner } from '@/lib/partners'

/**
 * Klantendashboard: uitgelicht nieuws, snelkoppelingen naar wat de klant bij
 * ons kan aanvragen of regelen (diensten het opvallendst), het eerstvolgende
 * event en onze partners. Enkel modules waarvoor de klant rechten heeft.
 */

export type Snel = {
  diensten: boolean; consultancy: boolean; founders: boolean; meetings: boolean; bestanden: boolean; events: boolean
}
type TeamMini = { id: string; voornaam: string; foto_url: string | null }
type EventMini = { id: string; titel: string; start_op: string; einde_op: string; prijs_cents: number; ingeschreven: boolean } | null

export function UitgelichtNieuws({ item }: { item: FeedItem }) {
  return (
    <section aria-label="Uitgelicht nieuws" className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Uitgelicht</h2>
        <Link href="/portal/nieuws" className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-black">Alle nieuws<ArrowRight className="h-4 w-4" /></Link>
      </div>
      <HeroKaart i={item} ongelezen={false} metKnop />
    </section>
  )
}

export function Snelkoppelingen({ mag, team, event, aantalEvents }: { mag: Snel; team: TeamMini[]; event: EventMini; aantalEvents: number }) {
  const groot = mag.diensten || mag.consultancy || mag.founders
  const klein = mag.meetings || mag.bestanden || mag.events
  if (!groot && !klein) return null
  const namen = team.map((t) => t.voornaam)
  const metWie = namen.length > 1 ? `${namen.slice(0, -1).join(', ')} of ${namen[namen.length - 1]}` : namen[0] ?? 'ons team'

  return (
    <section aria-label="Snelkoppelingen" className="space-y-4">
      {groot && (
        <div className="grid gap-4 lg:grid-cols-3">
          {mag.diensten && (
            <Link href="/portal/diensten" className={`group relative overflow-hidden rounded-3xl bg-gray-950 text-white p-6 sm:p-8 flex flex-col justify-between gap-6 min-h-[260px] ${mag.consultancy || mag.founders ? 'lg:col-span-2 lg:row-span-2' : 'lg:col-span-3'}`}>
              <div className="absolute -right-16 -top-16 h-64 w-64 rounded-full bg-white/10 blur-3xl" aria-hidden />
              <div className="absolute -left-10 bottom-0 h-40 w-40 rounded-full bg-white/5 blur-2xl" aria-hidden />
              <div className="relative space-y-3">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/20 px-3 py-1 text-xs font-medium text-white/80"><Sparkles className="h-3.5 w-3.5" />Diensten aanvragen</span>
                <h2 className="text-2xl sm:text-4xl font-semibold leading-tight text-white max-w-xl">Iets nieuws nodig? Vertel het ons.</h2>
                <p className="text-sm sm:text-base text-white/75 max-w-lg">Een shoot, een nieuwe website, advertenties of een ontwerp. Je kiest de dienst en wanneer het past, wij komen terug met een voorstel.</p>
              </div>
              <div className="relative flex flex-wrap items-center gap-3">
                <span className="inline-flex items-center gap-2 rounded-xl bg-white text-gray-900 font-semibold px-5 py-3 shadow-lg group-hover:gap-3 transition-all">Dienst aanvragen<ArrowRight className="h-4 w-4" /></span>
                <span className="text-xs text-white/60">Vrijblijvend · antwoord met een offerte</span>
              </div>
            </Link>
          )}
          {mag.consultancy && (
            <Link href="/portal/consultancy" className="group rounded-3xl border border-gray-200 bg-white p-6 flex flex-col justify-between gap-4 hover:border-gray-300 hover:shadow-md transition">
              <div className="space-y-2">
                <span className="h-10 w-10 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center"><Lightbulb className="h-5 w-5" /></span>
                <h3 className="text-lg font-semibold leading-snug">Even sparren met een expert</h3>
                <p className="text-sm text-gray-600">SEO, AI, campagnes of strategie. Je kiest zelf met wie.</p>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">€125 per uur</span>
                <span className="inline-flex items-center gap-1 text-sm font-semibold text-gray-900 group-hover:gap-2 transition-all">Aanvragen<ArrowRight className="h-4 w-4" /></span>
              </div>
            </Link>
          )}
          {mag.founders && (
            <Link href="/portal/founders" className="group relative overflow-hidden rounded-3xl bg-gradient-to-br from-gray-900 to-gray-700 text-white p-6 flex flex-col justify-between gap-4">
              <div className="space-y-2">
                <span className="h-10 w-10 rounded-xl bg-white/15 flex items-center justify-center"><Clapperboard className="h-5 w-5" /></span>
                <h3 className="text-lg font-semibold leading-snug text-white">Jouw verhaal in één video</h3>
                <p className="text-sm text-white/75">Founders of Flanders: hoe je begon en waar je naartoe wil.</p>
              </div>
              <span className="inline-flex items-center gap-1 text-sm font-semibold group-hover:gap-2 transition-all">Vraag je founder video aan<ArrowRight className="h-4 w-4" /></span>
            </Link>
          )}
        </div>
      )}

      {klein && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {mag.meetings && (
            <Link href="/portal/meetings" className="group rounded-2xl border border-gray-200 bg-white p-4 flex items-center gap-3 hover:border-gray-300 hover:shadow-sm transition">
              {team.length > 0 ? (
                <span className="flex -space-x-2 shrink-0">
                  {team.slice(0, 3).map((t) => (
                    <span key={t.id} className="h-10 w-10 rounded-full ring-2 ring-white bg-gray-200 overflow-hidden flex items-center justify-center text-xs font-semibold text-gray-500">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {t.foto_url ? <img src={t.foto_url} alt={t.voornaam} className="h-full w-full object-cover" /> : t.voornaam[0]}
                    </span>
                  ))}
                </span>
              ) : <span className="h-10 w-10 shrink-0 rounded-xl bg-gray-100 flex items-center justify-center"><Video className="h-5 w-5 text-gray-600" /></span>}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Plan een gratis meeting</span>
                <span className="block text-xs text-gray-500 line-clamp-2">30 minuten met {metWie}</span>
              </span>
              <ArrowRight className="h-4 w-4 text-gray-400 group-hover:text-gray-900 shrink-0" />
            </Link>
          )}
          {mag.bestanden && (
            <Link href="/portal/bestanden" className="group rounded-2xl border border-gray-200 bg-white p-4 flex items-center gap-3 hover:border-gray-300 hover:shadow-sm transition">
              <span className="h-10 w-10 shrink-0 rounded-xl bg-gray-100 flex items-center justify-center"><FolderUp className="h-5 w-5 text-gray-600" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">Beeldmateriaal aanleveren</span>
                <span className="block text-xs text-gray-500 truncate">Foto&apos;s, logo&apos;s of video&apos;s voor je content</span>
              </span>
              <ArrowRight className="h-4 w-4 text-gray-400 group-hover:text-gray-900 shrink-0" />
            </Link>
          )}
          {mag.events && (
            <Link href={event ? `/portal/events/${event.id}` : '/portal/events'} className="group rounded-2xl border border-gray-200 bg-white p-4 flex items-center gap-3 hover:border-gray-300 hover:shadow-sm transition">
              <span className="h-10 w-10 shrink-0 rounded-xl bg-gray-900 text-white flex items-center justify-center"><Ticket className="h-5 w-5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold truncate">{event ? event.titel : 'Workshops & events'}</span>
                <span className="block text-xs text-gray-500 truncate">
                  {event ? <><AftelLabel start={event.start_op} einde={event.einde_op} /> · {event.ingeschreven ? 'Je bent ingeschreven' : prijsTekst(event.prijs_cents)}</>
                    : aantalEvents ? `${aantalEvents} op de planning` : 'Bekijk wat er op de planning staat'}
                </span>
              </span>
              <ArrowRight className="h-4 w-4 text-gray-400 group-hover:text-gray-900 shrink-0" />
            </Link>
          )}
        </div>
      )}
    </section>
  )
}

export function PartnersStrook({ partners }: { partners: Partner[] }) {
  if (!partners.length) return null
  return (
    <section aria-label="Onze partners" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-gray-700">Onze partners</h2>
        <Link href="/portal/partners" className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-black">Alle partners<ArrowRight className="h-4 w-4" /></Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {partners.map((p) => {
          const logo = publiekeUrl(p.logo_pad)
          return (
            <Link key={p.id} href="/portal/partners" className="group rounded-2xl border border-gray-200 bg-white p-4 flex flex-col items-center justify-center gap-2 text-center hover:border-gray-300 hover:shadow-sm transition min-h-[110px]">
              {logo
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={logo} alt={p.naam} loading="lazy" className="max-h-12 max-w-[80%] object-contain" />
                : <CalendarDays className="hidden" aria-hidden />}
              <span className={`text-xs font-medium ${logo ? 'text-gray-500' : 'text-base font-semibold text-gray-900'}`}>{p.naam}</span>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
