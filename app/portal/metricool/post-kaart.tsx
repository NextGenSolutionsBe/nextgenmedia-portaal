'use client'

import { useState } from 'react'
import { ExternalLink, ImageOff } from 'lucide-react'
import { kortGetal, netwerkLabel, type PostCijfers } from '@/lib/metricool-stats'

const datum = (d: string | null) => (d ? new Date(d).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', timeZone: 'Europe/Brussels' }) : '')

/**
 * Eén post met zijn cijfers. Het beeld komt van het netwerk zelf (Instagram en
 * Facebook geven links die na een tijd verlopen): lukt het niet, dan een vlak.
 */
export function PostKaart({ netwerk, tekst, link, beeld, gepubliceerd, cijfers }: {
  netwerk: string; tekst: string | null; link: string | null; beeld: string | null; gepubliceerd: string | null; cijfers: PostCijfers
}) {
  const [stuk, setStuk] = useState(false)
  const regels: [string, number | null][] = [
    ['Interacties', cijfers.interacties],
    [cijfers.bereik !== null ? 'Bereik' : 'Weergaven', cijfers.bereik ?? cijfers.weergaven],
  ]
  const inhoud = (
    <>
      <div className="aspect-square bg-gray-100 overflow-hidden ">
        {beeld && !stuk
          ? <img src={beeld} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setStuk(true)} className="h-full w-full object-cover" />
          : <div className="h-full w-full flex items-center justify-center text-gray-300"><ImageOff className="h-8 w-8" /></div>}
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-center justify-between gap-2 text-xs text-gray-500">
          <span>{netwerkLabel(netwerk)} · {datum(gepubliceerd)}</span>
          {link && <ExternalLink className="h-3.5 w-3.5 shrink-0" />}
        </div>
        {tekst && <p className="text-sm text-gray-800 line-clamp-2">{tekst}</p>}
        <div className="flex gap-4 pt-1">
          {regels.map(([label, w]) => (
            <div key={label}>
              <div className="text-base font-semibold text-gray-900 tabular-nums">{kortGetal(w)}</div>
              <div className="text-[11px] text-gray-500">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
  const klas = 'block bg-white rounded-[14px] border border-black/[0.05] shadow-md overflow-hidden'
  return link
    ? <a href={link} target="_blank" rel="noopener noreferrer" className={`${klas} hover:shadow-lg transition-shadow`}>{inhoud}</a>
    : <div className={klas}>{inhoud}</div>
}
