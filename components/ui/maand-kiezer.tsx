'use client'

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const plus = (ym: string, n: number) => { const [y, m] = ym.split('-').map(Number); const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 7) }

/**
 * Maand kiezen uit een vaste lijst ("november 2026"), altijd als JJJJ-MM.
 * Werkt in elke browser — een <input type="month"> wordt in sommige browsers
 * een vrij tekstveld, waardoor "December" als maand kon binnensluipen.
 */
export function MaandKiezer({ waarde, onWaarde, vanaf, aantal = 36, leeg, className, id, disabled }: {
  waarde: string | null; onWaarde: (ym: string | null) => void; vanaf: string; aantal?: number; leeg?: string; className?: string; id?: string; disabled?: boolean
}) {
  const start = /^\d{4}-\d{2}$/.test(vanaf) ? vanaf : new Date().toISOString().slice(0, 7)
  const opties = Array.from({ length: aantal }, (_, i) => plus(start, i))
  if (waarde && /^\d{4}-\d{2}$/.test(waarde) && !opties.includes(waarde)) opties.unshift(waarde)
  return (
    <select id={id} className={className} disabled={disabled} value={waarde && /^\d{4}-\d{2}$/.test(waarde) ? waarde : ''} onChange={(e) => onWaarde(e.target.value || null)}>
      {leeg !== undefined && <option value="">{leeg}</option>}
      {opties.map((ym) => <option key={ym} value={ym}>{MAANDEN[Number(ym.slice(5, 7)) - 1]} {ym.slice(0, 4)}</option>)}
    </select>
  )
}
