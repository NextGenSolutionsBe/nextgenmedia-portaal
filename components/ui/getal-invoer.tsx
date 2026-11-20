'use client'

import { useEffect, useRef, useState } from 'react'
import { leesGetal, getalAlsInvoer } from '@/lib/getal'

/**
 * Invoerveld voor een getal (bedrag, aantal, %). Accepteert komma én punt,
 * houdt tijdens het typen de tekst vast ("12," blijft "12,") en geeft pas een
 * getal door zodra het er een is. Bij verlaten wordt het netjes "12,5".
 */
export function GetalInvoer({ waarde, onWaarde, leeg = 0, min, max, className, ...rest }: {
  waarde: number | null
  onWaarde: (n: number) => void
  /** Wat een leeg veld betekent. */
  leeg?: number
  min?: number
  max?: number
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'min' | 'max'>) {
  const [tekst, setTekst] = useState(getalAlsInvoer(waarde))
  const focus = useRef(false)
  // Waarde van buitenaf gewijzigd (niet tijdens het typen) → tekst bijwerken.
  useEffect(() => {
    if (!focus.current) setTekst(getalAlsInvoer(waarde))
  }, [waarde])
  const begrens = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n))
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      className={className}
      value={tekst}
      onFocus={(e) => { focus.current = true; rest.onFocus?.(e) }}
      onChange={(e) => {
        const t = e.target.value
        setTekst(t)
        const n = t.trim() === '' ? leeg : leesGetal(t)
        if (n !== null) onWaarde(begrens(n))
      }}
      onBlur={(e) => {
        focus.current = false
        const n = tekst.trim() === '' ? leeg : leesGetal(tekst)
        const def = n === null ? (waarde ?? leeg) : begrens(n)
        setTekst(getalAlsInvoer(def))
        if (n !== null && def !== waarde) onWaarde(def)
        rest.onBlur?.(e)
      }}
    />
  )
}
