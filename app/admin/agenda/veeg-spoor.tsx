'use client'

import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { verschuif, dagenVan, type Weergave } from '@/lib/agenda/model'

/**
 * Carrousel voor het vegen (veeg.ts): de vorige, huidige en volgende periode naast elkaar.
 * Tijdens het vegen schuift dit spoor mee met de vingers, zodat je de volgende week of maand al
 * ziet; na het doorschuiven wisselt de datum en springt het spoor stil terug naar het midden.
 * De panelen houden hun sleutel (begin van de periode), dus niets wordt opnieuw opgebouwd.
 */
export function VeegSpoor({ weergave, datum, render }: { weergave: Weergave; datum: string; render: (d: string, huidig: boolean, kant: -1 | 0 | 1) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const s = ref.current
    if (s) { s.style.transition = 'none'; s.style.transform = '' }
  }, [datum, weergave])
  const panelen = ([-1, 0, 1] as const).map((n) => ({ n, d: n ? verschuif(weergave, datum, n) : datum }))
  return (
    <div ref={ref} data-veeg-spoor className="relative h-full w-full">
      {panelen.map(({ n, d }) => (
        <div key={`${weergave}:${dagenVan(weergave, d)[0]}`} className={`absolute inset-0 ${n ? 'pointer-events-none' : ''}`} style={{ transform: n ? `translateX(${n * 100}%)` : undefined }} aria-hidden={n ? true : undefined}>
          {render(d, n === 0, n)}
        </div>
      ))}
    </div>
  )
}
