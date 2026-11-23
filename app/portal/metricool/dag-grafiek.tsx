'use client'

import { useEffect, useRef, useState } from 'react'
import { kortGetal, type Punt } from '@/lib/metricool-stats'

// Eén reeks, één kleur (geen legende nodig: de titel zegt wat het is).
const KLEUR = '#272727'
const RASTER = '#e5e7eb'
const AS_TEKST = '#6b7280'

const datumKort = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short' })

/** Een mooie bovengrens voor de as: 1, 2 of 5 × een macht van 10. */
function mooiMax(n: number): number {
  if (n <= 0) return 10
  const macht = 10 ** Math.floor(Math.log10(n))
  const f = n / macht
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * macht
}

/**
 * Dagcijfers als lijn (een stand, zoals volgers) of als balkjes (per dag, zoals
 * bereik). Bewegen over de grafiek toont de dag en het cijfer; "Tabel" toont
 * alles als getallen. De lijn begint niet bij nul: bij volgers gaat het om de
 * beweging, niet om de grootte.
 */
export function DagGrafiek({ titel, punten, soort, eenheid }: { titel: string; punten: Punt[]; soort: 'lijn' | 'balk'; eenheid: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [breedte, setBreedte] = useState(560)
  const [hover, setHover] = useState<number | null>(null)
  const [tabel, setTabel] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBreedte(Math.max(260, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const hoogte = 180
  const m = { l: 44, r: 8, t: 10, b: 24 }
  const b = breedte - m.l - m.r, h = hoogte - m.t - m.b
  const waarden = punten.map((p) => p.waarde)
  const min = soort === 'lijn' ? Math.min(...waarden) : 0
  const max = soort === 'lijn' ? Math.max(...waarden) : mooiMax(Math.max(...waarden, 1))
  const onder = soort === 'lijn' ? Math.floor(min - Math.max(1, (max - min) * 0.15)) : 0
  const boven = soort === 'lijn' ? Math.ceil(max + Math.max(1, (max - min) * 0.15)) : max
  const y = (v: number) => m.t + h - ((v - onder) / Math.max(1, boven - onder)) * h
  const stap = b / Math.max(1, punten.length)
  const x = (i: number) => m.l + stap * i + stap / 2
  const ticks = [onder, (onder + boven) / 2, boven].map((v) => Math.round(v))
  const labelElke = Math.max(1, Math.ceil(punten.length / Math.max(2, Math.floor(b / 70))))

  return (
    <div className="card-base">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h3 className="text-sm font-semibold text-gray-900">{titel}</h3>
        {punten.length > 0 && <button type="button" onClick={() => setTabel((t) => !t)} className="text-xs text-gray-500 hover:text-black">{tabel ? 'Grafiek' : 'Tabel'}</button>}
      </div>
      {punten.length === 0 ? (
        <p className="text-sm text-gray-500 py-10 text-center">Nog geen cijfers voor deze periode.</p>
      ) : tabel ? (
        <div className="max-h-[200px] overflow-y-auto text-sm">
          <table className="w-full tabular-nums">
            <thead><tr className="text-left text-xs text-gray-500"><th className="py-1 font-medium">Dag</th><th className="py-1 font-medium text-right">{eenheid}</th></tr></thead>
            <tbody>{[...punten].reverse().map((p) => <tr key={p.datum} className="border-t border-gray-100"><td className="py-1 text-gray-600">{datumKort(p.datum)}</td><td className="py-1 text-right text-gray-900">{Math.round(p.waarde).toLocaleString('nl-BE')}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative">
          <svg width={breedte} height={hoogte} role="img" aria-label={`${titel}: ${punten.length} dagen`} onMouseLeave={() => setHover(null)}
            onMouseMove={(e) => {
              const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
              const i = Math.floor((e.clientX - r.left - m.l) / stap)
              setHover(i >= 0 && i < punten.length ? i : null)
            }}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={m.l} x2={breedte - m.r} y1={y(t)} y2={y(t)} stroke={RASTER} strokeWidth={1} />
                <text x={m.l - 6} y={y(t) + 4} textAnchor="end" fontSize={10} fill={AS_TEKST}>{kortGetal(t)}</text>
              </g>
            ))}
            {punten.map((p, i) => (i % labelElke === 0 ? <text key={p.datum} x={x(i)} y={hoogte - 6} textAnchor="middle" fontSize={10} fill={AS_TEKST}>{datumKort(p.datum)}</text> : null))}
            {soort === 'balk'
              ? punten.map((p, i) => {
                  const bb = Math.max(1, stap - 2), top = y(p.waarde), hh = m.t + h - top
                  if (hh <= 0) return null
                  const r = Math.min(4, hh, bb / 2)
                  const x0 = x(i) - bb / 2
                  return <path key={p.datum} d={`M${x0},${top + hh} V${top + r} Q${x0},${top} ${x0 + r},${top} H${x0 + bb - r} Q${x0 + bb},${top} ${x0 + bb},${top + r} V${top + hh} Z`} fill={KLEUR} opacity={hover === null || hover === i ? 1 : 0.45} />
                })
              : <path d={punten.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.waarde)}`).join(' ')} fill="none" stroke={KLEUR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
            {hover !== null && soort === 'lijn' && (
              <>
                <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + h} stroke="#9ca3af" strokeWidth={1} />
                <circle cx={x(hover)} cy={y(punten[hover].waarde)} r={4} fill={KLEUR} stroke="#fff" strokeWidth={2} />
              </>
            )}
          </svg>
          {hover !== null && (
            <div className="pointer-events-none absolute top-0 rounded-md bg-gray-900 text-white text-xs px-2 py-1 shadow"
              style={{ left: Math.min(Math.max(0, x(hover) - 50), breedte - 110) }}>
              <div className="text-gray-300">{datumKort(punten[hover].datum)}</div>
              <div className="font-semibold tabular-nums">{Math.round(punten[hover].waarde).toLocaleString('nl-BE')} {eenheid.toLowerCase()}</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
