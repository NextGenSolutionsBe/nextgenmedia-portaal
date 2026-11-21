'use client'

import { useEffect } from 'react'

/**
 * Een ingeklapt blok (<details id="…">) vanzelf openklappen als je er via een
 * link met #id naartoe springt (bv. de tegel "gebruikers" in de klantfiche).
 */
export function OpenBijAnker({ id }: { id: string }) {
  useEffect(() => {
    const open = () => {
      if (window.location.hash !== `#${id}`) return
      const el = document.getElementById(id)
      if (el instanceof HTMLDetailsElement && !el.open) { el.open = true; el.scrollIntoView({ block: 'start' }) }
    }
    open()
    window.addEventListener('hashchange', open)
    return () => window.removeEventListener('hashchange', open)
  }, [id])
  return null
}
