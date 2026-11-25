'use client'

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/**
 * Zet iets rechtstreeks in <body>. Nodig voor vensters en menu's met `fixed`
 * die in een glaspaneel staan: `backdrop-filter` maakt anders van dat paneel de
 * referentie, en een "volledig scherm" wordt dan zo groot als het paneel.
 */
export function NaarBody({ children }: { children: ReactNode }) {
  const [klaar, setKlaar] = useState(false)
  useEffect(() => setKlaar(true), [])
  return klaar ? createPortal(children, document.body) : null
}
