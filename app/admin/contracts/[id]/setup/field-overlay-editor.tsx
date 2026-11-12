'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { GripVertical, Loader2, ChevronLeft, ChevronRight } from 'lucide-react'
import { FIELD_FONT_PT } from '@/lib/contract-render'
import { loadPdfjs } from '@/lib/pdfjs-laden'

// Echte WYSIWYG drag & drop editor: de PDF-pagina wordt met pdf.js naar een canvas
// gerenderd op exact dezelfde schaal als de overlay. Wat je hier ziet = wat op de
// uiteindelijke PDF terechtkomt (zelfde paginamaten, zelfde positie, zelfde font).

type Field = { label: string; type: string; page_number: number; x: number; y: number; width: number; height: number; required: boolean; placeholder?: string; confidence?: number }
type Zone = { sig_page: number; sig_x_pct: number; sig_y_pct: number; sig_width: number; sig_height: number }
/** Zone voor de handtekening van NextGenMedia (x/y in %, w/h in punten, zoals die van de klant). */
export type OnsZone = { page: number; x: number; y: number; w: number; h: number }

// pdf.js laden: één plek (lib/pdfjs-laden.ts), hier opnieuw uitgevoerd voor bestaande imports.
export { loadPdfjs }

export function FieldOverlayEditor({
  pdfUrl, fields, setFields, zone, setZone, page, setPage, selected, setSelected, ons, setOns,
}: {
  /** Zone voor onze eigen handtekening (NextGenMedia tekent na de klant). */
  ons?: OnsZone
  setOns?: (updater: (z: OnsZone) => OnsZone) => void
  pdfUrl: string | null
  fields: Field[]
  setFields: (updater: (f: Field[]) => Field[]) => void
  zone: Zone
  setZone: (updater: (z: Zone) => Zone) => void
  page: number
  setPage: (p: number) => void
  selected: number | null
  setSelected: (i: number | null) => void
}) {
  const [numPages, setNumPages] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  // Eén automatische poging om een verlopen downloadlink te vernieuwen.
  const vernieuwd = useRef(false)
  // Echte paginamaten (punten) + weergaveschaal (px per punt).
  const [pageDims, setPageDims] = useState<{ wPt: number; hPt: number; wPx: number; hPx: number }>({ wPt: 595, hPt: 842, wPx: 1, hPx: 1 })

  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pdfDocRef = useRef<any>(null)
  // pdf.js mag maar één weergave tegelijk op hetzelfde canvas: de vorige eerst annuleren.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const renderTaak = useRef<any>(null)
  const renderBeurt = useRef(0)
  // Nieuwe link (na vernieuwen) = document opnieuw ophalen. Staat vóór het
  // teken-effect, zodat de oude kopie eerst weg is.
  useEffect(() => { pdfDocRef.current = null }, [pdfUrl])
  const drag = useRef<null | { kind: 'field' | 'zone' | 'ons'; index: number; mode: 'move' | 'resize'; startX: number; startY: number; orig: { x: number; y: number; w: number; h: number } }>(null)

  const maxPage = Math.max(1, zone.sig_page, ons?.page ?? 1, ...fields.map((f) => f.page_number || 1))
  // Navigeer over álle PDF-pagina's (numPages), ook waar nog geen velden staan.
  const totalPages = Math.max(maxPage, numPages)
  const scale = pageDims.wPx / pageDims.wPt // px per punt

  // Render de gekozen pagina naar het canvas op de breedte van de container.
  const renderPage = useCallback(async () => {
    if (!pdfUrl || !wrapRef.current || !canvasRef.current) return
    const mijn = ++renderBeurt.current
    setLoading(true); setError(null)
    try {
      const pdfjs = await loadPdfjs()
      if (!pdfDocRef.current) {
        // De hele PDF één keer ophalen en uit het geheugen tekenen. Laat je
        // pdf.js zelf per stuk laden, dan haalt het bij elke nieuwe pagina opnieuw
        // bij de downloadlink — en die verloopt na een uur (fout 400).
        const res = await fetch(pdfUrl, { cache: 'no-store' })
        if (!res.ok) {
          if ([400, 401, 403].includes(res.status) && !vernieuwd.current) {
            // Link verlopen: de pagina maakt een verse aan; niet-opgeslagen velden blijven staan.
            vernieuwd.current = true
            router.refresh()
            return
          }
          throw new Error(res.status === 404 ? 'De PDF van dit contract werd niet gevonden.' : 'De downloadlink van de PDF is verlopen. Herlaad de pagina.')
        }
        const data = new Uint8Array(await res.arrayBuffer())
        pdfDocRef.current = await pdfjs.getDocument({ data }).promise
        vernieuwd.current = false
      }
      const doc = pdfDocRef.current
      if (mijn !== renderBeurt.current) return
      setNumPages(doc.numPages)
      const pageNum = Math.min(page, doc.numPages)
      const pdfPage = await doc.getPage(pageNum)
      const vp1 = pdfPage.getViewport({ scale: 1 }) // punten
      const containerWidth = wrapRef.current.clientWidth || 600
      const renderScale = containerWidth / vp1.width
      const vp = pdfPage.getViewport({ scale: renderScale })
      if (mijn !== renderBeurt.current || !canvasRef.current) return
      try { renderTaak.current?.cancel() } catch { /* al klaar */ }
      const canvas = canvasRef.current
      const ctx = canvas.getContext('2d')!
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      canvas.width = Math.floor(vp.width * dpr)
      canvas.height = Math.floor(vp.height * dpr)
      canvas.style.width = `${vp.width}px`
      canvas.style.height = `${vp.height}px`
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const taak = pdfPage.render({ canvasContext: ctx, viewport: vp })
      renderTaak.current = taak
      await taak.promise
      if (mijn !== renderBeurt.current) return
      setPageDims({ wPt: vp1.width, hPt: vp1.height, wPx: vp.width, hPx: vp.height })
    } catch (e) {
      // Geannuleerd door een nieuwere weergave: geen fout.
      if ((e as { name?: string })?.name === 'RenderingCancelledException' || mijn !== renderBeurt.current) return
      setError(e instanceof Error && !/getOrInsert|is not a function/i.test(e.message) ? e.message : 'De PDF kon niet geladen worden. Herlaad de pagina.')
    } finally {
      if (mijn === renderBeurt.current) setLoading(false)
    }
  }, [pdfUrl, page, router])

  useEffect(() => { renderPage() }, [renderPage])
  // Herteken bij venstergrootte-wijziging (schaal blijft exact).
  useEffect(() => {
    const onResize = () => renderPage()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [renderPage])

  const onPointerDown = (e: React.PointerEvent, kind: 'field' | 'zone' | 'ons', index: number, mode: 'move' | 'resize') => {
    e.preventDefault(); e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    const orig = kind === 'zone'
      ? { x: zone.sig_x_pct, y: zone.sig_y_pct, w: zone.sig_width, h: zone.sig_height }
      : kind === 'ons' && ons
        ? { x: ons.x, y: ons.y, w: ons.w, h: ons.h }
        : { x: fields[index].x, y: fields[index].y, w: fields[index].width, h: fields[index].height }
    drag.current = { kind, index, mode, startX: e.clientX, startY: e.clientY, orig }
    if (kind === 'field') setSelected(index)
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    const dxPct = ((e.clientX - d.startX) / pageDims.wPx) * 100
    const dyPct = ((e.clientY - d.startY) / pageDims.hPx) * 100
    const clamp = (v: number) => Math.max(0, Math.min(99, v))
    if (d.mode === 'move') {
      const nx = clamp(d.orig.x + dxPct)
      const ny = clamp(d.orig.y + dyPct)
      if (d.kind === 'zone') setZone((z) => ({ ...z, sig_x_pct: round1(nx), sig_y_pct: round1(ny) }))
      else if (d.kind === 'ons') setOns?.((z) => ({ ...z, x: round1(nx), y: round1(ny) }))
      else setFields((fs) => fs.map((f, i) => i === d.index ? { ...f, x: round1(nx), y: round1(ny) } : f))
    } else {
      // Resize: pixel-delta exact terug naar punten via de echte schaal.
      const dwPt = (e.clientX - d.startX) / scale
      const dhPt = (e.clientY - d.startY) / scale
      const nw = Math.max(30, Math.round(d.orig.w + dwPt))
      const nh = Math.max(12, Math.round(d.orig.h + dhPt))
      if (d.kind === 'zone') setZone((z) => ({ ...z, sig_width: Math.max(50, nw), sig_height: Math.max(24, nh) }))
      else if (d.kind === 'ons') setOns?.((z) => ({ ...z, w: Math.min(400, Math.max(60, nw)), h: Math.min(200, Math.max(24, nh)) }))
      else setFields((fs) => fs.map((f, i) => i === d.index ? { ...f, width: nw, height: nh } : f))
    }
  }
  const onPointerUp = () => { drag.current = null }

  // Posities in px op basis van de echte paginamaten.
  const boxStyle = (x: number, y: number, w: number, h: number): React.CSSProperties => ({
    left: `${(x / 100) * pageDims.wPx}px`,
    top: `${(y / 100) * pageDims.hPx}px`,
    width: `${Math.max(8, w * scale)}px`,
    height: `${Math.max(10, h * scale)}px`,
  })
  // Fontgrootte exact zoals de stamping (FIELD_FONT_PT punten → px via schaal).
  const fontPx = FIELD_FONT_PT * scale

  const pageFields = fields.map((f, i) => ({ f, i })).filter(({ f }) => (f.page_number || 1) === page)

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs flex-wrap">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1}
            className="h-7 px-2 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-0.5"
            title="Vorige pagina"
          >
            <ChevronLeft className="h-3.5 w-3.5" />Vorige
          </button>
          <span className="text-gray-500">Pagina:</span>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <button key={p} onClick={() => setPage(p)} className={`h-7 w-7 rounded-lg text-xs font-medium ${p === page ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{p}</button>
          ))}
          <button onClick={() => setPage(totalPages + 1)} className="h-7 px-2 rounded-lg text-xs border border-dashed border-gray-300 text-gray-500 hover:bg-gray-50">+ pagina</button>
          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages}
            className="h-7 px-2 rounded-lg text-xs font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-0.5"
            title="Volgende pagina"
          >
            Volgende<ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <p className="text-[11px] text-gray-400">Sleep om te verplaatsen · hoekje rechtsonder om te vergroten · exact zoals op de PDF</p>
      </div>

      <div ref={wrapRef} className="relative w-full border-2 border-gray-200 rounded-lg overflow-hidden bg-gray-100" style={{ minHeight: 120 }}>
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        )}
        {error ? (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm px-4 text-center">{error}</div>
        ) : !pdfUrl ? (
          <div className="flex items-center justify-center h-64 text-gray-400 text-sm">Geen PDF beschikbaar</div>
        ) : (
          <div className="relative" style={{ width: pageDims.wPx, height: pageDims.hPx }}>
            <canvas ref={canvasRef} className="block" />
            {/* Overlay exact over het canvas */}
            <div
              className="absolute inset-0"
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerLeave={onPointerUp}
              onClick={() => setSelected(null)}
              style={{ touchAction: 'none' }}
            >
              {pageFields.map(({ f, i }) => {
                const lowConf = typeof f.confidence === 'number' && f.confidence < 0.6
                return (
                  <div
                    key={i}
                    onPointerDown={(e) => onPointerDown(e, 'field', i, 'move')}
                    className={`absolute rounded-sm border bg-blue-500/10 cursor-move select-none ${selected === i ? 'border-blue-600 ring-1 ring-blue-400' : lowConf ? 'border-amber-500 border-dashed' : 'border-blue-400'}`}
                    style={boxStyle(f.x, f.y, f.width, f.height)}
                    title={lowConf ? 'Lage zekerheid — controle aanbevolen' : f.label}
                  >
                    {/* De waarde/het label op exact dezelfde plek + grootte als de stamping */}
                    <span
                      className="absolute left-0 top-0 whitespace-nowrap text-gray-900 leading-none overflow-hidden"
                      style={{ fontSize: `${fontPx}px`, lineHeight: 1 }}
                    >
                      {f.placeholder || f.label}
                    </span>
                    <GripVertical className="absolute -left-3 top-0 h-3 w-3 text-blue-500" />
                    <span onPointerDown={(e) => onPointerDown(e, 'field', i, 'resize')} className="absolute -bottom-1 -right-1 h-3 w-3 bg-blue-600 rounded-sm cursor-se-resize" />
                  </div>
                )
              })}

              {zone.sig_page === page && (
                <div
                  onPointerDown={(e) => onPointerDown(e, 'zone', -1, 'move')}
                  className="absolute rounded border-2 border-gray-900 bg-gray-100 flex items-center justify-center cursor-move select-none"
                  style={boxStyle(zone.sig_x_pct, zone.sig_y_pct, zone.sig_width, zone.sig_height)}
                >
                  <span className="text-[10px] text-gray-900 font-semibold">✎ Handtekening klant</span>
                  <span onPointerDown={(e) => onPointerDown(e, 'zone', -1, 'resize')} className="absolute -bottom-1 -right-1 h-3 w-3 bg-gray-900 rounded-sm cursor-se-resize" />
                </div>
              )}

              {ons && ons.page === page && (
                <div
                  onPointerDown={(e) => onPointerDown(e, 'ons', -1, 'move')}
                  className="absolute rounded border-2 border-amber-500 bg-amber-100/80 flex items-center justify-center cursor-move select-none"
                  style={boxStyle(ons.x, ons.y, ons.w, ons.h)}
                >
                  <span className="text-[10px] text-amber-900 font-semibold">✎ Handtekening NextGenMedia</span>
                  <span onPointerDown={(e) => onPointerDown(e, 'ons', -1, 'resize')} className="absolute -bottom-1 -right-1 h-3 w-3 bg-amber-600 rounded-sm cursor-se-resize" />
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1">
        {zone.sig_page !== page && (
          <button onClick={() => setZone((z) => ({ ...z, sig_page: page }))} className="text-xs text-gray-900 hover:underline">
            ✎ Handtekening klant naar pagina {page}
          </button>
        )}
        {ons && setOns && ons.page !== page && (
          <button onClick={() => setOns((z) => ({ ...z, page }))} className="text-xs text-amber-800 hover:underline">
            ✎ Handtekening NextGenMedia naar pagina {page}
          </button>
        )}
      </div>
    </div>
  )
}

function round1(v: number) { return Math.round(v * 10) / 10 }
