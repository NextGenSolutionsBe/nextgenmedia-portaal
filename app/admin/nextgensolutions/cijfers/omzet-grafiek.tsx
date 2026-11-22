'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { maandKort, maandLabel, maandenTussen, omzetPerMaand, plusMaanden, type Deal } from '@/lib/ngs/model'
import { eur } from '../ui'

// Twee reeksen, gevalideerd voor kleurenblindheid en contrast (dataviz-palet, plaatsen 1 en 2).
const KLEUR = { terugkerend: '#2a78d6', eenmalig: '#eb6834' }
const RASTER = '#e5e7eb'
const AS_TEKST = '#6b7280'

/** Een mooie bovengrens voor de as: 1, 2 of 5 × een macht van 10. */
function mooiMax(n: number): number {
  if (n <= 0) return 1000
  const macht = 10 ** Math.floor(Math.log10(n))
  const f = n / macht
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * macht
}
const kortEur = (n: number) => (n >= 1000 ? `€ ${(n / 1000).toLocaleString('nl-BE', { maximumFractionDigits: 1 })}k` : `€ ${Math.round(n)}`)

/** Pad van een balk met afgeronde bovenkant (de data-kant) en een rechte voet. */
function balk(x: number, y: number, b: number, h: number, r: number): string {
  const rr = Math.min(r, h, b / 2)
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + b - rr} Q${x + b},${y} ${x + b},${y + rr} V${y + h} Z`
}

/**
 * Omzet per maand: de laatste 12 maanden en de volgende 6 (wat de lopende
 * contracten nog opleveren, gearceerd). Gestapeld: eenmalig en terugkerend.
 * Bewegen over een maand toont de bedragen; "Tabel" toont alles als getallen.
 */
export function OmzetGrafiek({ deals, vandaag }: { deals: Deal[]; vandaag: string }) {
  const nu = vandaag.slice(0, 7)
  const maanden = useMemo(() => maandenTussen(plusMaanden(nu, -11), plusMaanden(nu, 6)), [nu])
  const reeks = useMemo(() => omzetPerMaand(deals, maanden), [deals, maanden])
  const ref = useRef<HTMLDivElement>(null)
  const [breedte, setBreedte] = useState(640)
  const [hover, setHover] = useState<number | null>(null)
  const [tabel, setTabel] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBreedte(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const H = 220, L = 44, R = 4, T = 10, B = 24
  const plot = { b: breedte - L - R, h: H - T - B }
  const max = mooiMax(Math.max(...reeks.map((m) => m.totaal), 0))
  const band = plot.b / reeks.length
  const dik = Math.min(24, Math.max(6, band * 0.62))
  const y = (v: number) => T + plot.h - (v / max) * plot.h
  const elke = breedte < 520 ? 3 : breedte < 760 ? 2 : 1
  const leeg = reeks.every((m) => m.totaal === 0)

  return (
    <section className="card-base space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-semibold text-gray-900">Omzet per maand</h2>
          <p className="text-xs text-gray-500">Gewonnen deals, excl. btw. Gearceerd = wat de lopende contracten nog opleveren.</p>
        </div>
        <button type="button" onClick={() => setTabel((t) => !t)} aria-pressed={tabel} className="text-xs px-2.5 py-1 rounded-full border border-gray-200 hover:bg-gray-50">{tabel ? 'Grafiek' : 'Tabel'}</button>
      </div>

      {/* Legende: altijd, want er zijn twee reeksen */}
      <div className="flex items-center gap-4 flex-wrap text-xs text-gray-700">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: KLEUR.terugkerend }} />Terugkerend</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: KLEUR.eenmalig }} />Eenmalig</span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden>
            <defs><pattern id="ngs-arcering-legende" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="4" height="4" fill={KLEUR.terugkerend} opacity="0.35" /><line x1="0" y1="0" x2="0" y2="4" stroke={KLEUR.terugkerend} strokeWidth="2" /></pattern></defs>
            <rect width="10" height="10" rx="2" fill="url(#ngs-arcering-legende)" />
          </svg>Verwacht
        </span>
      </div>

      {tabel ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-gray-500"><th className="py-1.5 pr-3 font-medium">Maand</th><th className="py-1.5 pr-3 font-medium text-right">Eenmalig</th><th className="py-1.5 pr-3 font-medium text-right">Terugkerend</th><th className="py-1.5 font-medium text-right">Totaal</th></tr></thead>
            <tbody className="divide-y divide-gray-100">
              {reeks.map((m) => (
                <tr key={m.maand} className={m.maand > nu ? 'text-gray-500' : ''}>
                  <td className="py-1.5 pr-3 capitalize">{maandLabel(m.maand)}{m.maand > nu ? ' (verwacht)' : ''}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{eur(m.eenmalig)}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{eur(m.terugkerend)}</td>
                  <td className="py-1.5 text-right tabular-nums font-semibold">{eur(m.totaal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative" onMouseLeave={() => setHover(null)}>
          <svg width={breedte} height={H} role="img" aria-label="Omzet per maand, eenmalig en terugkerend" className="block">
            <defs>
              {(['terugkerend', 'eenmalig'] as const).map((k) => (
                <pattern key={k} id={`ngs-arcering-${k}`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill={KLEUR[k]} opacity="0.35" />
                  <line x1="0" y1="0" x2="0" y2="6" stroke={KLEUR[k]} strokeWidth="3" opacity="0.85" />
                </pattern>
              ))}
            </defs>
            {/* Raster en as: rustig */}
            {[0, 0.5, 1].map((f) => (
              <g key={f}>
                <line x1={L} x2={L + plot.b} y1={y(max * f)} y2={y(max * f)} stroke={RASTER} strokeWidth="1" />
                <text x={L - 6} y={y(max * f) + 3.5} textAnchor="end" fontSize="10" fill={AS_TEKST}>{kortEur(max * f)}</text>
              </g>
            ))}
            {reeks.map((m, i) => {
              const x = L + i * band + (band - dik) / 2
              const verwacht = m.maand > nu
              const hE = (m.eenmalig / max) * plot.h
              const hT = (m.terugkerend / max) * plot.h
              const voet = T + plot.h
              // Onderaan terugkerend, erboven eenmalig; 2px gat ertussen; enkel de bovenste is afgerond.
              const delen: { k: 'terugkerend' | 'eenmalig'; h: number }[] = [{ k: 'terugkerend' as const, h: hT }, { k: 'eenmalig' as const, h: hE }].filter((d) => d.h > 0.5)
              let top = voet
              return (
                <g key={m.maand} opacity={hover === null || hover === i ? 1 : 0.55}>
                  {delen.map((d, j) => {
                    const gat = j > 0 ? 2 : 0
                    const h = Math.max(1, d.h - gat)
                    const yy = top - gat - h
                    top = yy
                    const vul = verwacht ? `url(#ngs-arcering-${d.k})` : KLEUR[d.k]
                    return j === delen.length - 1
                      ? <path key={d.k} d={balk(x, yy, dik, h, 4)} fill={vul} />
                      : <rect key={d.k} x={x} y={yy} width={dik} height={h} fill={vul} />
                  })}
                  {i % elke === (reeks.length - 1) % elke && (
                    <text x={Math.min(x + dik / 2, breedte - 2)} y={H - 6} textAnchor={x + dik / 2 + 16 > breedte ? 'end' : 'middle'} fontSize="10" fill={m.maand === nu ? '#111827' : AS_TEKST} fontWeight={m.maand === nu ? 600 : 400}>{maandKort(m.maand)}</text>
                  )}
                  {/* Raakvlak: de hele kolom, groter dan de balk */}
                  <rect x={L + i * band} y={T} width={band} height={plot.h} fill="transparent" onMouseEnter={() => setHover(i)} onClick={() => setHover(i)} />
                </g>
              )
            })}
            {/* Vandaag: waar verwacht begint */}
            {(() => { const i = reeks.findIndex((m) => m.maand > nu); if (i < 0) return null; const x = L + i * band; return <line x1={x} x2={x} y1={T} y2={T + plot.h} stroke="#9ca3af" strokeDasharray="3 3" strokeWidth="1" /> })()}
          </svg>
          {leeg && <p className="absolute inset-0 flex items-center justify-center text-sm text-gray-500 pointer-events-none">Nog geen gewonnen deals met een bedrag.</p>}
          {hover !== null && (() => {
            const m = reeks[hover]
            const x = L + hover * band + band / 2
            const links = Math.min(Math.max(x - 90, 0), breedte - 180)
            return (
              <div className="absolute top-0 z-10 w-[180px] rounded-xl bg-white border border-gray-200 shadow-lg px-3 py-2 text-xs pointer-events-none" style={{ left: links }}>
                <div className="font-semibold text-gray-900 capitalize">{maandLabel(m.maand)}{m.maand > nu ? ' · verwacht' : ''}</div>
                <div className="mt-1 space-y-0.5 text-gray-700">
                  <div className="flex justify-between gap-2"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: KLEUR.terugkerend }} />Terugkerend</span><span className="tabular-nums">{eur(m.terugkerend)}</span></div>
                  <div className="flex justify-between gap-2"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: KLEUR.eenmalig }} />Eenmalig</span><span className="tabular-nums">{eur(m.eenmalig)}</span></div>
                  <div className="flex justify-between gap-2 border-t border-gray-100 pt-0.5 font-semibold text-gray-900"><span>Totaal</span><span className="tabular-nums">{eur(m.totaal)}</span></div>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </section>
  )
}
