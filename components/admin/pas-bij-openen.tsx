'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * Toont de inhoud van een ingeklapt blok (`<details>`) pas als het voor het
 * eerst opengeklapt wordt. Zo halen de kaarten erin hun gegevens niet op bij
 * het openen van de pagina, maar pas als iemand ze echt wil zien. Daarna blijft
 * de inhoud staan (dichtklappen gooit niets weg).
 */
export function PasBijOpenen({ children, className }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [getoond, setGetoond] = useState(false)
  useEffect(() => {
    const blok = ref.current?.closest('details')
    if (!blok) { setGetoond(true); return }
    const kijk = () => { if (blok.open) setGetoond(true) }
    kijk()
    blok.addEventListener('toggle', kijk)
    return () => blok.removeEventListener('toggle', kijk)
  }, [])
  return <div ref={ref} className={className}>{getoond ? children : null}</div>
}
