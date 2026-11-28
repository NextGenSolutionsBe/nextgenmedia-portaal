'use client'

import { useEffect, useState } from 'react'
import { BAND_TEKST } from '@/lib/ritme/model'

type Rij = { bedrijf: string; teFactureren: number; gefactureerd13: number; weken: number | null; band: 'kort' | 'goed' | 'lang' | null }
const NAAM: Record<string, string> = { nextgenmedia: 'NextGenMedia', nextgensolutions: 'NextGenSolutions' }
const KLEUR = { kort: 'text-red-700', goed: 'text-gray-900', lang: 'text-[#166534]' } as const
const EUR = (n: number) => n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 })

/**
 * Werkvoorraad per bedrijf (verbeterplan fase 7, punt 97): hoeveel weken
 * getekend werk er nog te factureren ligt, aan het tempo van de laatste 13
 * weken. Minder dan 2 weken = dringend verkopen. Enkel voor de zaakvoerders.
 */
export function WerkvoorraadBlok() {
  const [rijen, setRijen] = useState<Rij[] | null>(null)
  useEffect(() => { fetch('/api/admin/ritme?deel=werkvoorraad', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((j) => setRijen(j?.werkvoorraad ?? [])).catch(() => setRijen([])) }, [])
  const zichtbaar = (rijen ?? []).filter((r) => r.weken !== null || r.teFactureren > 0)
  if (!zichtbaar.length) return null
  return (
    <section className="card-base">
      <div className="flex items-baseline gap-2 flex-wrap mb-2"><h2 className="font-semibold text-sm">Werkvoorraad</h2><span className="text-xs text-gray-500">Getekend en nog te factureren, in weken aan het tempo van de laatste 13 weken.</span></div>
      <div className="grid gap-2 sm:grid-cols-2">
        {zichtbaar.map((r) => (
          <div key={r.bedrijf} className="rounded-xl border border-gray-200 p-3">
            <div className="text-xs text-gray-500">{NAAM[r.bedrijf] ?? r.bedrijf}</div>
            <div className={`text-lg sm:text-2xl font-semibold tabular-nums ${r.band ? KLEUR[r.band] : ''}`}>{r.weken === null ? '—' : `${r.weken.toLocaleString('nl-BE')} weken`}</div>
            <div className="text-[11px] text-gray-500 tabular-nums">{EUR(r.teFactureren)} nog te factureren · {EUR(r.gefactureerd13 / 13)} per week{r.band ? ` · ${BAND_TEKST[r.band]}` : ''}</div>
          </div>
        ))}
      </div>
    </section>
  )
}
