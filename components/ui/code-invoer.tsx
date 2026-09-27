'use client'

import { forwardRef } from 'react'

/**
 * Invoer voor een 6-cijferige code (mailcode of authenticator-app).
 * Eén veld: numeriek toetsenbord op telefoon, automatisch invullen vanuit sms/
 * mail (one-time-code), en plakken van een volledige code ("123 456", "123-456")
 * werkt — alles behalve cijfers valt weg. Enter verstuurt het formulier.
 */
export const CodeInvoer = forwardRef<HTMLInputElement, {
  waarde: string
  onWijzig: (v: string) => void
  autoFocus?: boolean
  disabled?: boolean
  label?: string
  id?: string
}>(function CodeInvoer({ waarde, onWijzig, autoFocus, disabled, label = '6-cijferige code', id = 'code' }, ref) {
  return (
    <input
      ref={ref}
      id={id}
      aria-label={label}
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="one-time-code"
      autoFocus={autoFocus}
      disabled={disabled}
      required
      maxLength={12}
      value={waarde}
      onChange={(e) => onWijzig(e.target.value.replace(/\D/g, '').slice(0, 6))}
      onPaste={(e) => {
        const cijfers = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
        if (cijfers) { e.preventDefault(); onWijzig(cijfers) }
      }}
      className="input-base text-center text-2xl tracking-[0.4em] font-semibold tabular-nums"
      placeholder="••••••"
    />
  )
})
