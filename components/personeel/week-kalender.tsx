'use client'

import { useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'

/**
 * Weekkalender met een tijdraster, gebruikt voor beschikbaarheid en inboeken
 * (admin én medewerker). Sleep over een dag om een tijdvak te kiezen (op
 * telefoon: tik = één uur). Per persoon een eigen "baan" per dag, in zijn kleur:
 *  · beschikbaarheid = lichte achtergrond in de kleur van die persoon
 *  · werkblok        = volle kleur; wacht op bevestiging = gestreepte rand
 */

export type WkItem = {
  id: string
  datum: string            // YYYY-MM-DD
  start: string            // HH:MM
  eind: string             // HH:MM
  laan: string             // meestal het personeel-id
  kleur: string            // #rrggbb
  soort: 'beschikbaar' | 'werkblok'
  titel: string
  sub?: string | null
  status?: 'te_bevestigen' | 'bevestigd' | 'geweigerd'
  onClick?: () => void
}

export type WkSelectie = { datum: string; start: string; eind: string; laan: string | null }

const UUR_PX = 44
const SNAP = 15
const DAGEN = ['Ma', 'Di', 'Wo', 'Do', 'Vr', 'Za', 'Zo']

const min = (u: string) => { const [h, m] = u.split(':').map(Number); return h * 60 + (m || 0) }
const uur = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
export const plusDagen = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
/** De maandag van de week waarin deze dag valt. */
export function maandagVan(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  const dow = (d.getUTCDay() + 6) % 7
  return plusDagen(iso, -dow)
}
const kort = (iso: string) => iso.slice(8, 10) + '/' + iso.slice(5, 7)

/** Kleur met doorzichtigheid (hex → rgba). */
export function tint(hex: string, a: number): string {
  const h = /^#([0-9a-f]{6})$/i.exec(hex)?.[1] ?? '9ca3af'
  const n = parseInt(h, 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`
}

export function WeekNavigatie({ maandag, onMaandag, vandaag }: { maandag: string; onMaandag: (m: string) => void; vandaag: string }) {
  const zondag = plusDagen(maandag, 6)
  return (
    <div className="flex items-center gap-1.5">
      <button type="button" className="btn-secondary !px-2" aria-label="Vorige week" onClick={() => onMaandag(plusDagen(maandag, -7))}><ChevronLeft className="h-4 w-4" /></button>
      <button type="button" className="btn-secondary text-xs" onClick={() => onMaandag(maandagVan(vandaag))}>Deze week</button>
      <button type="button" className="btn-secondary !px-2" aria-label="Volgende week" onClick={() => onMaandag(plusDagen(maandag, 7))}><ChevronRight className="h-4 w-4" /></button>
      <span className="text-sm font-medium text-gray-700 ml-1">{kort(maandag)} – {kort(zondag)}</span>
    </div>
  )
}

export function WeekKalender({ maandag, items, onSelectie, lanen, vanUur = 7, totUur = 22, vandaag }: {
  maandag: string
  items: WkItem[]
  onSelectie?: (s: WkSelectie) => void
  /** Volgorde van de banen (bv. personeel-id's); onbekende komen achteraan. */
  lanen?: string[]
  vanUur?: number
  totUur?: number
  vandaag?: string
}) {
  const dagen = Array.from({ length: 7 }, (_, i) => plusDagen(maandag, i))
  const hoogte = (totUur - vanUur) * UUR_PX
  const [sel, setSel] = useState<{ datum: string; a: number; b: number; laan: string | null } | null>(null)
  const drag = useRef<{ datum: string; a: number; x0: number; y0: number; laan: string | null; kolom: HTMLDivElement; bewogen: boolean } | null>(null)

  const naarMin = (y: number) => {
    const m = vanUur * 60 + Math.round((y / UUR_PX) * 60 / SNAP) * SNAP
    return Math.max(vanUur * 60, Math.min(totUur * 60, m))
  }
  const lanenVan = (datum: string) => {
    const set = [...new Set(items.filter((i) => i.datum === datum).map((i) => i.laan))]
    return set.sort((x, y) => {
      const ix = lanen?.indexOf(x) ?? -1, iy = lanen?.indexOf(y) ?? -1
      return (ix < 0 ? 999 : ix) - (iy < 0 ? 999 : iy)
    })
  }
  const laanOp = (datum: string, x: number, breedte: number) => {
    const l = lanenVan(datum)
    return l.length ? l[Math.min(l.length - 1, Math.floor((x / breedte) * l.length))] : null
  }

  const start = (e: React.PointerEvent<HTMLDivElement>, datum: string) => {
    if (!onSelectie || e.button !== 0) return
    const kolom = e.currentTarget
    const r = kolom.getBoundingClientRect()
    const a = naarMin(e.clientY - r.top)
    drag.current = { datum, a, x0: e.clientX, y0: e.clientY, laan: laanOp(datum, e.clientX - r.left, r.width), kolom, bewogen: false }
    if (e.pointerType === 'mouse') { kolom.setPointerCapture(e.pointerId); setSel({ datum, a, b: a + SNAP, laan: drag.current.laan }) }
  }
  const beweeg = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current; if (!d || e.pointerType !== 'mouse') return
    if (Math.abs(e.clientY - d.y0) > 4) d.bewogen = true
    const b = naarMin(e.clientY - d.kolom.getBoundingClientRect().top)
    setSel({ datum: d.datum, a: Math.min(d.a, b), b: Math.max(d.a, b), laan: d.laan })
  }
  const stop = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current; drag.current = null
    if (!d || !onSelectie) return
    // Tikken / klikken zonder slepen = één uur vanaf dat moment.
    const tik = !d.bewogen || e.pointerType !== 'mouse'
    let a = d.a, b = tik ? d.a + 60 : naarMin(e.clientY - d.kolom.getBoundingClientRect().top)
    if (b < a) [a, b] = [b, a]
    if (b - a < 30) b = a + 30
    b = Math.min(b, totUur * 60)
    setSel(null)
    if (e.pointerType !== 'mouse' && (Math.abs(e.clientX - d.x0) > 10 || Math.abs(e.clientY - d.y0) > 10)) return // was scrollen
    onSelectie({ datum: d.datum, start: uur(a), eind: uur(b), laan: d.laan })
  }

  return (
    <div className="overflow-x-auto -mx-1 px-1">
      <div className="min-w-[640px]">
        {/* Kop */}
        <div className="grid" style={{ gridTemplateColumns: '40px repeat(7, minmax(0, 1fr))' }}>
          <div />
          {dagen.map((d, i) => (
            <div key={d} className={`text-center text-xs py-1.5 font-medium ${d === vandaag ? 'text-black' : 'text-gray-500'}`}>
              <span className={d === vandaag ? 'bg-[#fff848] rounded-md px-1.5 py-0.5' : ''}>{DAGEN[i]} {kort(d)}</span>
            </div>
          ))}
        </div>
        {/* Raster */}
        <div className="grid border border-gray-200 rounded-xl overflow-hidden bg-white" style={{ gridTemplateColumns: '40px repeat(7, minmax(0, 1fr))' }}>
          <div className="relative border-r border-gray-100" style={{ height: hoogte }}>
            {Array.from({ length: totUur - vanUur }, (_, i) => (
              <div key={i} className="absolute right-1 text-[10px] text-gray-400 -translate-y-1/2" style={{ top: i * UUR_PX }}>{i === 0 ? '' : `${vanUur + i}u`}</div>
            ))}
          </div>
          {dagen.map((datum) => {
            const l = lanenVan(datum)
            const dagItems = items.filter((i) => i.datum === datum)
            return (
              <div key={datum}
                className={`relative border-r border-gray-100 last:border-r-0 select-none ${onSelectie ? 'cursor-crosshair' : ''} ${datum === vandaag ? 'bg-[#fff848]/5' : ''}`}
                style={{ height: hoogte, backgroundImage: `repeating-linear-gradient(to bottom, #f3f4f6 0, #f3f4f6 1px, transparent 1px, transparent ${UUR_PX}px)`, touchAction: 'pan-y' }}
                onPointerDown={(e) => start(e, datum)} onPointerMove={beweeg} onPointerUp={stop} onPointerCancel={() => { drag.current = null; setSel(null) }}>
                {dagItems.sort((a, b) => (a.soort === b.soort ? 0 : a.soort === 'beschikbaar' ? -1 : 1)).map((it) => {
                  const idx = Math.max(0, l.indexOf(it.laan)), n = Math.max(1, l.length)
                  const top = ((min(it.start) - vanUur * 60) / 60) * UUR_PX
                  const h = Math.max(14, ((min(it.eind) - min(it.start)) / 60) * UUR_PX)
                  const links = `calc(${(idx / n) * 100}% + ${it.soort === 'werkblok' ? 3 : 1}px)`
                  const breed = `calc(${100 / n}% - ${it.soort === 'werkblok' ? 6 : 2}px)`
                  if (it.soort === 'beschikbaar') {
                    return (
                      <button key={it.id} type="button" title={`${it.titel} · ${it.start}–${it.eind}`}
                        onPointerDown={(e) => { if (it.onClick) e.stopPropagation() }} onClick={it.onClick}
                        className={`absolute rounded-md text-left overflow-hidden ${it.onClick ? 'hover:brightness-95' : 'pointer-events-none'}`}
                        style={{ top, height: h, left: links, width: breed, background: tint(it.kleur, 0.18), borderLeft: `3px solid ${it.kleur}` }}>
                        <div className="px-1 pt-0.5 text-[10px] leading-tight font-medium truncate" style={{ color: it.kleur }}>{it.titel}</div>
                        <div className="px-1 text-[9px] leading-tight text-gray-500 truncate">{it.start}–{it.eind}</div>
                      </button>
                    )
                  }
                  const wacht = it.status === 'te_bevestigen', nee = it.status === 'geweigerd'
                  return (
                    <button key={it.id} type="button" title={`${it.titel}${it.sub ? ` · ${it.sub}` : ''} · ${it.start}–${it.eind}`}
                      onPointerDown={(e) => e.stopPropagation()} onClick={it.onClick}
                      className={`absolute rounded-md text-left overflow-hidden shadow-sm ${nee ? 'opacity-50 line-through' : ''}`}
                      style={{ top, height: h, left: links, width: breed, background: wacht ? `repeating-linear-gradient(135deg, ${it.kleur}, ${it.kleur} 6px, ${tint(it.kleur, 0.75)} 6px, ${tint(it.kleur, 0.75)} 12px)` : it.kleur, color: '#fff', zIndex: 2 }}>
                      <div className="px-1 pt-0.5 text-[10px] leading-tight font-semibold truncate">{it.titel}</div>
                      <div className="px-1 text-[9px] leading-tight opacity-90 truncate">{it.start}–{it.eind}{wacht ? ' · wacht' : nee ? ' · kan niet' : ''}</div>
                    </button>
                  )
                })}
                {sel && sel.datum === datum && (
                  <div className="absolute inset-x-0.5 rounded-md border-2 border-black/70 bg-[#fff848]/40 pointer-events-none z-10"
                    style={{ top: ((sel.a - vanUur * 60) / 60) * UUR_PX, height: Math.max(8, ((sel.b - sel.a) / 60) * UUR_PX) }}>
                    <div className="text-[10px] font-semibold px-1">{uur(sel.a)}–{uur(sel.b)}</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
