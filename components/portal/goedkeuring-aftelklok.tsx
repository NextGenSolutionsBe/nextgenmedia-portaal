'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Hourglass, ArrowRight } from 'lucide-react'
import { t, type Lang } from '@/lib/i18n'

export type AftelItem = { id: string; maanden: string; datum: string; eindeIso: string; open: number }

/**
 * Aftelklok in het klantenportaal: tegen wanneer moet de content van welke
 * maand(en) goedgekeurd zijn, en hoeveel staat er nog open. Rood in de laatste
 * 24 uur. Werkt elke 30 seconden bij.
 */
export function GoedkeuringAftelklok({ items, lang, link = false }: { items: AftelItem[]; lang: Lang; link?: boolean }) {
  const [nu, setNu] = useState(() => Date.now())
  useEffect(() => { const k = setInterval(() => setNu(Date.now()), 30000); return () => clearInterval(k) }, [])
  if (!items.length) return null
  return (
    <div className="space-y-2">
      {items.map((it) => {
        const ms = Math.max(0, Date.parse(it.eindeIso) - nu)
        const d = Math.floor(ms / 86400000), u = Math.floor((ms % 86400000) / 3600000), m = Math.floor((ms % 3600000) / 60000)
        const tijd = d > 0 ? t(lang, 'deadline.dagen', { d, u }) : t(lang, 'deadline.uren', { u, m })
        const dringend = ms < 86400000
        const inhoud = (
          <div className={`flex items-start gap-3 p-4 rounded-xl border ${dringend ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'}`}>
            <Hourglass className={`h-5 w-5 mt-0.5 shrink-0 ${dringend ? 'text-red-600' : 'text-amber-600'}`} />
            <div className="min-w-0 flex-1">
              <div className={`font-semibold text-sm ${dringend ? 'text-red-800' : 'text-amber-900'}`}>{t(lang, 'deadline.titel', { maanden: it.maanden, datum: it.datum })}</div>
              <div className={`text-2xl font-bold tabular-nums leading-tight mt-0.5 ${dringend ? 'text-red-700' : 'text-amber-800'}`}>{t(lang, dringend ? 'deadline.laatsteUren' : 'deadline.resterend', { tijd })}</div>
              <div className={`text-xs mt-1 ${dringend ? 'text-red-700' : 'text-amber-700'}`}>{t(lang, 'deadline.open', { n: it.open })} {t(lang, 'deadline.uitleg')}</div>
            </div>
            {link && <ArrowRight className={`h-4 w-4 mt-1 shrink-0 ${dringend ? 'text-red-600' : 'text-amber-600'}`} />}
          </div>
        )
        return link ? <Link key={it.id} href="/portal/social-media" aria-label={t(lang, 'deadline.bekijk')}>{inhoud}</Link> : <div key={it.id}>{inhoud}</div>
      })}
    </div>
  )
}
