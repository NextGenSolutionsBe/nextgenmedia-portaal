'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Loader2, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { HandtekeningVak } from '@/components/admin/handtekening-vak'
import { loadPdfjs, type OnsZone } from '../setup/field-overlay-editor'

const rond = (v: number) => Math.round(v * 10) / 10

/**
 * Onze handtekening plaatsen en zetten. Links de PDF zoals de klant hem tekende,
 * met het gele vak waar onze handtekening komt (verslepen en vergroten kan);
 * rechts naam en handtekening. Wat je ziet is wat op de PDF komt.
 */
export function TegentekenScherm({ contractId, pdfUrl, beginZone, beginNaam, bedrijf, klant }: {
  contractId: string
  pdfUrl: string | null
  beginZone: OnsZone
  beginNaam: string
  bedrijf: string
  klant: { naam: string | null; op: string | null; manueel: boolean }
}) {
  const router = useRouter()
  const [zone, setZone] = useState<OnsZone>(beginZone)
  const [naam, setNaam] = useState(beginNaam)
  const [png, setPng] = useState<string | null>(null)
  const [bezig, setBezig] = useState(false)

  const teken = async () => {
    if (!png) { toast.error('Teken eerst je handtekening.'); return }
    if (naam.trim().length < 2) { toast.error('Vul je naam in.'); return }
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/tegentekenen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handtekening: png, zone, naam }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Tekenen mislukt')
      toast.success(j.certificaatNr ? `Ondertekend. Nieuw certificaat ${j.certificaatNr}${j.legal ? ', ook naar Legal gestuurd' : ''}.` : 'Ondertekend.')
      router.push(`/admin/contracts/${contractId}`)
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Tekenen mislukt'); setBezig(false) }
  }

  const op = klant.op ? new Date(klant.op).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : null
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
      <PdfMetVak pdfUrl={pdfUrl} zone={zone} setZone={setZone} png={png} />
      <aside className="card-base space-y-4 lg:sticky lg:top-6">
        <div>
          <h2 className="font-semibold text-gray-900">Namens {bedrijf}</h2>
          <p className="text-xs text-gray-500 mt-1">
            {klant.manueel ? 'De klant tekende buiten de app.' : `${klant.naam ?? 'De klant'} tekende${op ? ` op ${op}` : ''}.`} Jouw handtekening komt op een kopie. Het exemplaar van de klant blijft zoals het is.
          </p>
        </div>
        <label className="block">
          <span className="block text-xs font-medium text-gray-600 mb-1">Naam onder de handtekening</span>
          <input value={naam} onChange={(e) => setNaam(e.target.value)} maxLength={80} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900/15 focus:border-gray-900" />
        </label>
        <div>
          <span className="block text-xs font-medium text-gray-600 mb-1">Handtekening</span>
          <HandtekeningVak onChange={setPng} hoogte={150} />
        </div>
        <p className="text-[11px] text-gray-500">Sleep het gele vak op de PDF naar de juiste plek (pagina {zone.page}). Daarna staat het contract met beide handtekeningen in de klantapp en komt er een nieuw certificaat.</p>
        <button type="button" onClick={teken} disabled={bezig || !png || naam.trim().length < 2} className="btn-primary w-full">
          {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}Ondertekenen
        </button>
      </aside>
    </div>
  )
}

/** Eén PDF-pagina met het verplaatsbare vak voor onze handtekening. */
function PdfMetVak({ pdfUrl, zone, setZone, png }: { pdfUrl: string | null; zone: OnsZone; setZone: (u: (z: OnsZone) => OnsZone) => void; png: string | null }) {
  const wrap = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const doc = useRef<any>(null)
  const [aantal, setAantal] = useState(1)
  const [maten, setMaten] = useState({ wPt: 595, hPt: 842, wPx: 1, hPx: 1 })
  const [laden, setLaden] = useState(false)
  const [fout, setFout] = useState<string | null>(null)
  const sleep = useRef<null | { modus: 'move' | 'resize'; sx: number; sy: number; o: OnsZone }>(null)
  // pdf.js mag maar één weergave tegelijk op hetzelfde canvas: de vorige eerst annuleren.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const weergave = useRef<any>(null)
  const beurt = useRef(0)
  const schaal = maten.wPx / maten.wPt

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
      const p = await d.getPage(Math.min(zone.page, d.numPages))
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
      // Geannuleerd door een nieuwere weergave: geen fout.
      if ((e as { name?: string })?.name === 'RenderingCancelledException' || mijn !== beurt.current) return
      setFout(e instanceof Error && !/getOrInsert|is not a function/i.test(e.message) ? e.message : 'De PDF kon niet geladen worden. Herlaad de pagina.')
    } finally { if (mijn === beurt.current) setLaden(false) }
  }, [pdfUrl, zone.page])
  useEffect(() => { teken() }, [teken])
  useEffect(() => { const f = () => teken(); window.addEventListener('resize', f); return () => window.removeEventListener('resize', f) }, [teken])

  const neer = (e: React.PointerEvent, modus: 'move' | 'resize') => {
    e.preventDefault(); e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    sleep.current = { modus, sx: e.clientX, sy: e.clientY, o: zone }
  }
  const beweeg = (e: React.PointerEvent) => {
    const s = sleep.current
    if (!s) return
    if (s.modus === 'move') {
      const nx = Math.max(0, Math.min(98, s.o.x + ((e.clientX - s.sx) / maten.wPx) * 100))
      const ny = Math.max(0, Math.min(98, s.o.y + ((e.clientY - s.sy) / maten.hPx) * 100))
      setZone((z) => ({ ...z, x: rond(nx), y: rond(ny) }))
    } else {
      const nw = Math.min(400, Math.max(60, Math.round(s.o.w + (e.clientX - s.sx) / schaal)))
      const nh = Math.min(200, Math.max(24, Math.round(s.o.h + (e.clientY - s.sy) / schaal)))
      setZone((z) => ({ ...z, w: nw, h: nh }))
    }
  }
  const los = () => { sleep.current = null }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-xs flex-wrap">
        <button type="button" onClick={() => setZone((z) => ({ ...z, page: Math.max(1, z.page - 1) }))} disabled={zone.page <= 1} className="h-7 px-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-0.5"><ChevronLeft className="h-3.5 w-3.5" />Vorige</button>
        <span className="text-gray-500">Pagina</span>
        {Array.from({ length: aantal }, (_, i) => i + 1).map((p) => (
          <button key={p} type="button" onClick={() => setZone((z) => ({ ...z, page: p }))} className={`h-7 w-7 rounded-lg font-medium ${p === zone.page ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>{p}</button>
        ))}
        <button type="button" onClick={() => setZone((z) => ({ ...z, page: Math.min(aantal, z.page + 1) }))} disabled={zone.page >= aantal} className="h-7 px-2 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40 flex items-center gap-0.5">Volgende<ChevronRight className="h-3.5 w-3.5" /></button>
        <span className="text-[11px] text-gray-400 ml-auto">Het vak gaat mee naar de pagina die je kiest</span>
      </div>
      <div ref={wrap} className="relative w-full border-2 border-gray-200 rounded-lg overflow-hidden bg-gray-100" style={{ minHeight: 160 }}>
        {laden && <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/60"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>}
        {fout ? <div className="flex items-center justify-center h-64 text-gray-500 text-sm px-4 text-center">{fout}</div> : !pdfUrl ? (
          <div className="flex items-center justify-center h-64 text-gray-500 text-sm">Geen PDF gevonden.</div>
        ) : (
          <div className="relative" style={{ width: maten.wPx, height: maten.hPx }}>
            <canvas ref={canvas} className="block" />
            <div className="absolute inset-0" onPointerMove={beweeg} onPointerUp={los} onPointerLeave={los} style={{ touchAction: 'none' }}>
              <div onPointerDown={(e) => neer(e, 'move')} data-vak="ons"
                className="absolute rounded border-2 border-amber-500 bg-amber-100/70 flex items-center justify-center cursor-move select-none"
                style={{ left: `${(zone.x / 100) * maten.wPx}px`, top: `${(zone.y / 100) * maten.hPx}px`, width: `${zone.w * schaal}px`, height: `${zone.h * schaal}px` }}>
                {png
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={png} alt="" className="max-w-full max-h-full object-contain pointer-events-none" />
                  : <span className="text-[10px] text-amber-900 font-semibold text-center px-1">✎ Handtekening NextGenMedia</span>}
                <span onPointerDown={(e) => neer(e, 'resize')} className="absolute -bottom-1 -right-1 h-3 w-3 bg-amber-600 rounded-sm cursor-se-resize" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
