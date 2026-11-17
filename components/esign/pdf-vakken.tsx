'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { loadPdfjs } from '@/lib/pdfjs-laden'
import type { Zone } from '@/lib/algemene-contracten/model'

const rond = (v: number) => Math.round(v * 10) / 10
/** Hoogte (punten) per regel onder de handtekening; zelfde als op de PDF (lib/algemene-contracten/pdf.ts). */
const REGEL = 10

export type Vak = {
  key: string
  /** Wat in het vak staat zolang er nog geen handtekening is. */
  label: string
  kleur: 'geel' | 'blauw'
  zone: Zone
  /** De getekende handtekening (PNG data-URL), om te tonen in het vak. */
  png?: string | null
  /** Regels onder de handtekening (naam, datum en uur). */
  regels: string[]
  /** Mag verplaatst en vergroot worden. */
  bewerkbaar: boolean
}

const STIJL = {
  geel: { vak: 'border-amber-500 bg-amber-100/60', tekst: 'text-amber-900', hoek: 'bg-amber-600' },
  blauw: { vak: 'border-blue-500 bg-blue-100/60', tekst: 'text-blue-900', hoek: 'bg-blue-600' },
}

/**
 * Eén PDF-pagina met de vakken voor de handtekeningen: verslepen, vergroten en
 * met de paginaknoppen naar een andere pagina brengen (het actieve vak gaat
 * mee). Zelfde rekenwijze als de PDF: x/y in % vanaf linksboven, breedte en
 * hoogte in punten.
 */
export function PdfVakken({ pdfUrl, vakken, actief, onZone, onPagina }: {
  pdfUrl: string | null
  vakken: Vak[]
  /** Het vak dat met de paginaknoppen meegaat. */
  actief?: string | null
  onZone?: (key: string, z: Zone) => void
  onPagina?: (p: number) => void
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = useRef<any>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const weergave = useRef<any>(null)
  const beurt = useRef(0)
  const actiefVak = vakken.find((v) => v.key === actief) ?? vakken.find((v) => v.bewerkbaar) ?? vakken[0]
  const [pagina, setPagina] = useState(actiefVak?.zone.page ?? 1)
  const [aantal, setAantal] = useState(1)
  const [maten, setMaten] = useState({ wPt: 595, hPt: 842, wPx: 1, hPx: 1 })
  const [laden, setLaden] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const sleep = useRef<null | { key: string; modus: 'move' | 'resize'; sx: number; sy: number; o: Zone }>(null)
  const schaal = maten.wPx / maten.wPt

  // Een ander vak actief: toon zijn pagina.
  useEffect(() => { if (actiefVak) setPagina(actiefVak.zone.page) }, [actiefVak?.key]) // eslint-disable-line react-hooks/exhaustive-deps

  const teken = useCallback(async () => {
    if (!pdfUrl || !wrap.current || !canvas.current) return
    const mijn = ++beurt.current
    setLaden(true); setFout(null)
    try {
      const pdfjs = await loadPdfjs()
      if (!doc.current) {
        const r = await fetch(pdfUrl, { cache: 'no-store' })
        if (!r.ok) throw new Error('De PDF kon niet geladen worden. Herlaad de pagina.')
        doc.current = await pdfjs.getDocument({ data: new Uint8Array(await r.arrayBuffer()) }).promise
      }
      const d = doc.current
      if (mijn !== beurt.current) return
      setAantal(d.numPages)
      const p = await d.getPage(Math.min(pagina, d.numPages))
      const vp1 = p.getViewport({ scale: 1 })
      const vp = p.getViewport({ scale: (wrap.current.clientWidth || 600) / vp1.width })
      if (mijn !== beurt.current || !canvas.current) return
      try { weergave.current?.cancel() } catch { /* al klaar */ }
      const c = canvas.current, ctx = c.getContext('2d')!
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr)
      c.style.width = `${vp.width}px`; c.style.height = `${vp.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const taak = p.render({ canvasContext: ctx, viewport: vp })
      weergave.current = taak
      await taak.promise
      if (mijn !== beurt.current) return
      setMaten({ wPt: vp1.width, hPt: vp1.height, wPx: vp.width, hPx: vp.height })
    } catch (e) {
      if ((e as { name?: string })?.name === 'RenderingCancelledException' || mijn !== beurt.current) return
      setFout(e instanceof Error && !/getOrInsert|is not a function/i.test(e.message) ? e.message : 'De PDF kon niet geladen worden. Herlaad de pagina.')
    } finally { if (mijn === beurt.current) setLaden(false) }
  }, [pdfUrl, pagina])
  useEffect(() => { teken() }, [teken])
  useEffect(() => { const f = () => teken(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [teken])

  const naarPagina = (p: number) => {
    const n = Math.max(1, Math.min(aantal, p))
    setPagina(n)
    onPagina?.(n)
    if (actiefVak?.bewerkbaar && onZone) onZone(actiefVak.key, { ...actiefVak.zone, page: n })
  }

  const neer = (e: React.PointerEvent, v: Vak, modus: 'move' | 'resize') => {
    if (!v.bewerkbaar) return
    e.preventDefault(); e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    sleep.current = { key: v.key, modus, sx: e.clientX, sy: e.clientY, o: v.zone }
  }
  const beweeg = (e: React.PointerEvent) => {
    const s = sleep.current
    if (!s || !onZone) return
    if (s.modus === 'move') {
      const nx = Math.max(0, Math.min(98, s.o.x + ((e.clientX - s.sx) / maten.wPx) * 100))
      const ny = Math.max(0, Math.min(98, s.o.y + ((e.clientY - s.sy) / maten.hPx) * 100))
      onZone(s.key, { ...s.o, x: rond(nx), y: rond(ny) })
    } else {
      const nw = Math.min(400, Math.max(60, Math.round(s.o.w + (e.clientX - s.sx) / schaal)))
      const nh = Math.min(200, Math.max(24, Math.round(s.o.h + (e.clientY - s.sy) / schaal)))
      onZone(s.key, { ...s.o, w: nw, h: nh })
    }
  }
  const los = () => { sleep.current = null }

  return (
    <div className="space-y-2">
      {aantal > 1 && (
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          <button type="button" onClick={() => naarPagina(pagina - 1)} disabled={pagina <= 1} className="h-7 px-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-0.5"><ChevronLeft className="h-3.5 w-3.5" />Vorige</button>
          <span className="text-gray-500">Pagina</span>
          {Array.from({ length: aantal }, (_, i) => i + 1).map((p) => (
            <button key={p} type="button" onClick={() => naarPagina(p)} className={`h-7 min-w-7 px-1.5 rounded-lg font-medium ${p === pagina ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{p}</button>
          ))}
          <button type="button" onClick={() => naarPagina(pagina + 1)} disabled={pagina >= aantal} className="h-7 px-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-0.5">Volgende<ChevronRight className="h-3.5 w-3.5" /></button>
          {actiefVak?.bewerkbaar && <span className="text-[11px] text-gray-400 ml-auto">Het vak “{actiefVak.label}” gaat mee naar de pagina die je kiest</span>}
        </div>
      )}
      <div ref={wrap} className="relative w-full border-2 border-gray-200 rounded-lg overflow-hidden bg-gray-100" style={{ minHeight: 160 }}>
        {laden && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
        {fout ? <div className="flex items-center justify-center h-64 text-gray-500 text-sm px-4 text-center">{fout}</div> : !pdfUrl ? (
          <div className="flex items-center justify-center h-64 text-gray-500 text-sm">Geen PDF gevonden.</div>
        ) : (
          <div className="relative" style={{ width: maten.wPx, height: maten.hPx }}>
            <canvas ref={canvas} className="block" />
            <div className="absolute inset-0" onPointerMove={beweeg} onPointerUp={los} onPointerLeave={los} style={{ touchAction: 'none' }}>
              {vakken.filter((v) => v.zone.page === pagina).map((v) => {
                const st = STIJL[v.kleur]
                const regelsH = v.regels.length * REGEL * schaal
                return (
                  <div key={v.key} onPointerDown={(e) => neer(e, v, 'move')} data-vak={v.key}
                    className={`absolute rounded border-2 ${st.vak} flex flex-col select-none ${v.bewerkbaar ? 'cursor-move' : ''}`}
                    style={{ left: `${(v.zone.x / 100) * maten.wPx}px`, top: `${(v.zone.y / 100) * maten.hPx}px`, width: `${v.zone.w * schaal}px`, height: `${v.zone.h * schaal}px` }}>
                    <div className="flex-1 min-h-0 flex items-end justify-center">
                      {v.png
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={v.png} alt="" className="max-w-full max-h-full object-contain pointer-events-none" />
                        : <span className={`text-[10px] ${st.tekst} font-semibold text-center px-1 self-center`}>✎ {v.label}</span>}
                    </div>
                    <div className="shrink-0 flex flex-col items-center justify-end text-gray-800 leading-none overflow-hidden pointer-events-none" style={{ height: `${regelsH}px` }}>
                      {v.regels.map((r, i) => <span key={i} className="whitespace-nowrap" style={{ fontSize: `${Math.max(7, 8 * schaal)}px`, height: `${REGEL * schaal}px`, lineHeight: `${REGEL * schaal}px` }}>{r}</span>)}
                    </div>
                    {v.bewerkbaar && <span onPointerDown={(e) => neer(e, v, 'resize')} className={`absolute -bottom-1 -right-1 h-3 w-3 ${st.hoek} rounded-sm cursor-se-resize`} />}
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
