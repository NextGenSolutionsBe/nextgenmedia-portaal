'use client'

import { useLayoutEffect, useRef } from 'react'

/**
 * Tabel die op telefoon als kaarten verschijnt. Wikkel een gewone <table> in
 * <KaartTabel>: op ≥ md blijft het een tabel, op telefoon wordt elke rij een
 * kaart en krijgt elke cel de kolomkop als label (via data-label; de CSS staat
 * in app/globals.css onder .kaart-tabel). Werkt ook als rijen later wijzigen.
 *
 * Een cel met data-label="" (of een cel over meerdere kolommen) krijgt geen label;
 * de eerste cel is de titel van de kaart.
 */
export function KaartTabel({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const label = () => {
      for (const table of el.querySelectorAll('table')) {
        const koppen = [...table.querySelectorAll('thead th')].flatMap((th) => {
          const n = Math.max(1, Number((th as HTMLTableCellElement).colSpan) || 1)
          const t = (th.textContent ?? '').trim()
          return Array.from({ length: n }, () => t)
        })
        for (const tr of table.querySelectorAll('tbody tr, tfoot tr')) {
          let kolom = 0
          for (const td of tr.children) {
            const cel = td as HTMLTableCellElement
            const span = Math.max(1, Number(cel.colSpan) || 1)
            if (!cel.hasAttribute('data-label') || cel.dataset.auto === '1') {
              cel.setAttribute('data-label', span > 1 ? '' : koppen[kolom] ?? '')
              cel.dataset.auto = '1'
            }
            kolom += span
          }
        }
      }
    }
    label()
    const obs = new MutationObserver(label)
    obs.observe(el, { childList: true, subtree: true })
    return () => obs.disconnect()
  }, [])
  return <div ref={ref} className={`kaart-tabel ${className}`}>{children}</div>
}
