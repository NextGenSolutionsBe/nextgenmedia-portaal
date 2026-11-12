'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Hourglass, ChevronRight, FileText, Video, Image as ImageIcon } from 'lucide-react'
import { t, type Lang } from '@/lib/i18n'
import { aftelStand, aftelTekst, maandenTekst, vandaagBrussel } from '@/lib/content/deadline-model'

export type GoedkeuringItem = { id: string; title: string; planned_date: string; content_type: string }
export type Goedkeuring = { id: string; maanden: string[]; deadline: string; aangevraagdOp: string; items: GoedkeuringItem[] }

const TYPE_ICON: Record<string, React.ComponentType<{ className?: string }>> = { reel: Video, story: ImageIcon }

/**
 * Wat op de goedkeuring van de klant wacht, per aangevraagde termijn: welke
 * content, wanneer voorgelegd, de uiterste datum en hoeveel dagen er nog zijn.
 * De aftelling wordt berekend uit de datum van vandaag (Brussel) en elke minuut
 * opnieuw bekeken, dus nooit een vaste tekst. Een verstreken termijn blijft
 * staan zolang er iets wacht; is alles goedgekeurd, dan verdwijnt de kaart.
 */
export function GoedkeuringOverzicht({ goedkeuringen, lang, onOpen }: {
  goedkeuringen: Goedkeuring[]
  lang: Lang
  /** In de kalender: het item daar openen. Zonder: een link naar de kalender. */
  onOpen?: (id: string) => void
}) {
  const [vandaag, setVandaag] = useState(() => vandaagBrussel())
  useEffect(() => { const k = setInterval(() => setVandaag(vandaagBrussel()), 60000); return () => clearInterval(k) }, [])
  const zichtbaar = goedkeuringen.filter((g) => g.items.length > 0)
  if (!zichtbaar.length) return null
  const datum = (d: string, lang2: Lang) => new Date(d.length === 10 ? `${d}T12:00:00Z` : d).toLocaleDateString(lang2 === 'en' ? 'en-GB' : 'nl-BE', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Europe/Brussels' })

  return (
    <div className="space-y-3" id="goedkeuring">
      {zichtbaar.map((g) => {
        const stand = aftelStand(g.deadline, vandaag)
        const dringend = stand.soort === 'vandaag' || (stand.soort === 'dagen' && stand.dagen <= 1)
        const kleur = stand.soort === 'verstreken'
          ? { kaart: 'bg-gray-50 border-gray-200', icoon: 'text-gray-500', titel: 'text-gray-800', groot: 'text-gray-700', klein: 'text-gray-600' }
          : dringend
            ? { kaart: 'bg-red-50 border-red-200', icoon: 'text-red-600', titel: 'text-red-800', groot: 'text-red-700', klein: 'text-red-700' }
            : { kaart: 'bg-amber-50 border-amber-200', icoon: 'text-amber-600', titel: 'text-amber-900', groot: 'text-amber-800', klein: 'text-amber-800' }
        return (
          <section key={g.id} className={`rounded-xl border p-4 ${kleur.kaart}`} aria-label={t(lang, 'goedkeuring.titel', { maanden: maandenTekst(g.maanden, lang) })}>
            <div className="flex items-start gap-3">
              <Hourglass className={`h-5 w-5 mt-0.5 shrink-0 ${kleur.icoon}`} />
              <div className="min-w-0 flex-1">
                <h2 className={`font-semibold text-sm ${kleur.titel}`}>{t(lang, 'goedkeuring.titel', { maanden: maandenTekst(g.maanden, lang) })}</h2>
                <p className={`text-2xl font-bold leading-tight mt-0.5 ${kleur.groot}`}>{aftelTekst(stand, lang)}</p>
                <p className={`text-xs mt-1 ${kleur.klein}`}>
                  {t(lang, 'goedkeuring.voorgelegd', { datum: datum(g.aangevraagdOp, lang) })} · {t(lang, 'goedkeuring.uiterlijk', { datum: datum(g.deadline, lang) })}
                </p>
              </div>
            </div>
            <ul className="mt-3 divide-y divide-black/5 rounded-lg bg-white/70 border border-black/5">
              {g.items.map((it) => {
                const Icon = TYPE_ICON[it.content_type] ?? FileText
                const inhoud = (
                  <>
                    <Icon className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                    <span className="flex-1 min-w-0 truncate text-sm text-gray-800">{it.title}</span>
                    <span className="text-xs text-gray-500 tabular-nums shrink-0">{new Date(`${it.planned_date}T12:00:00Z`).toLocaleDateString(lang === 'en' ? 'en-GB' : 'nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' })}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                  </>
                )
                const cls = 'w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white rounded-lg'
                return (
                  <li key={it.id}>
                    {onOpen
                      ? <button type="button" onClick={() => onOpen(it.id)} className={cls} aria-label={`${t(lang, 'goedkeuring.bekijk')}: ${it.title}`}>{inhoud}</button>
                      : <Link href={`/portal/social-media?item=${it.id}`} className={cls} aria-label={`${t(lang, 'goedkeuring.bekijk')}: ${it.title}`}>{inhoud}</Link>}
                  </li>
                )
              })}
            </ul>
            <p className={`text-xs mt-2 ${kleur.klein}`}>{t(lang, stand.soort === 'verstreken' ? 'goedkeuring.verstrekenUitleg' : 'goedkeuring.uitleg')}</p>
          </section>
        )
      })}
    </div>
  )
}
