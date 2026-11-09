'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Loader2, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { HandtekeningVak } from '@/components/admin/handtekening-vak'
import { loadPdfjs, type OnsZone } from '../setup/field-overlay-editor'
import { DATUM_HOOGTE, datumRegel } from '@/lib/contracten/tegenhandtekening'

const rond = (v: number) => Math.round(v * 10) / 10

/**
 * Onze handtekening plaatsen en zetten. Links de PDF zoals de klant hem tekende,
 * met het gele blok waar onze handtekening komt: de handtekening met eronder
 * datum en uur van tekenen (vanzelf ingevuld). Rechts enkel tekenen. Met
 * "Ondertekenen en volgende" ga je meteen naar het volgende contract.
 */
export function TegentekenScherm({ contractId, pdfUrl, beginZone, naam, bedrijf, klant, volgendeId, aantalOpen, positie }: {
  contractId: string
  pdfUrl: string | null
  beginZone: OnsZone
  /** Naam uit je account; staat in het certificaat, niet in het blok. */
  naam: string
  bedrijf: string
  klant: { naam: string | null; op: string | null; manueel: boolean }
  /** Het volgende contract dat nog op onze handtekening wacht (null = dit is het laatste). */
  volgendeId: string | null
  aantalOpen: number
  positie: number
}) {
  const router = useRouter()
  const [zone, setZone] = useState<OnsZone>(beginZone)
  const [png, setPng] = useState<string | null>(null)
  const [vorige, setVorige] = useState<string | null | undefined>(undefined)
  const [bezig, setBezig] = useState(false)
  const [datum, setDatum] = useState(() => datumRegel(new Date()))
  // Datum en uur lopen mee tot je tekent; de server zet het echte moment van tekenen.
  useEffect(() => { const t = setInterval(() => setDatum(datumRegel(new Date())), 15_000); return () => clearInterval(t) }, [])
  // Je handtekening van het vorige contract staat klaar (enkel in dit tabblad); opnieuw tekenen kan altijd.
  useEffect(() => { try { setVorige(sessionStorage.getItem(BEWAAR)) } catch { setVorige(null) } }, [])
  const kies = (v: string | null) => { setPng(v); try { if (v) sessionStorage.setItem(BEWAAR, v); else sessionStorage.removeItem(BEWAAR) } catch { /* geen opslag */ } }

  const teken = async (doorgaan: boolean) => {
    if (!png) { toast.error('Teken eerst je handtekening.'); return }
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/tegentekenen`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ handtekening: png, zone }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Tekenen mislukt')
      if (doorgaan && volgendeId) {
        toast.success(`Ondertekend. Nog ${aantalOpen - 1} te gaan.`)
        router.push(`/admin/contracts/${volgendeId}/tegentekenen`)
      } else {
        toast.success(volgendeId ? 'Ondertekend.' : 'Ondertekend. Alle contracten zijn door ons getekend.')
        router.push(`/admin/contracts/${contractId}`)
        router.refresh()
      }
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Tekenen mislukt'); setBezig(false) }
  }

  const op = klant.op ? new Date(klant.op).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' }) : null
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_340px] gap-6 items-start">
      <PdfMetVak pdfUrl={pdfUrl} zone={zone} setZone={setZone} png={png} datum={datum} />
      <aside className="card-base space-y-4 lg:sticky lg:top-6">
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="font-medium text-gray-700">Contract {positie} van {aantalOpen} te tekenen</span>
          {volgendeId && <Link href={`/admin/contracts/${volgendeId}/tegentekenen`} className="inline-flex items-center gap-0.5 text-gray-500 hover:text-black">Overslaan<ChevronRight className="h-3.5 w-3.5" /></Link>}
        </div>
        <div>
          <h2 className="font-semibold text-gray-900">Namens {bedrijf}</h2>
          <p className="text-xs text-gray-500 mt-1">
            {klant.manueel ? 'De klant tekende buiten de app.' : `${klant.naam ?? 'De klant'} tekende${op ? ` op ${op}` : ''}.`} Je tekent als {naam}. Datum en uur komen vanzelf onder je handtekening.
          </p>
        </div>
        <div>
          <span className="block text-xs font-medium text-gray-600 mb-1">Handtekening</span>
          {vorige === undefined ? <div className="h-[150px] rounded-xl border border-dashed border-gray-300" /> : (
            <HandtekeningVak key={vorige ? 'vorige' : 'leeg'} onChange={kies} beginWaarde={vorige} hoogte={150} />
          )}
          {vorige && png === vorige && <p className="text-[11px] text-gray-500 mt-1">Je handtekening van het vorige contract staat klaar.</p>}
        </div>
        <div className="space-y-2">
          {volgendeId ? (
            <>
              <button type="button" onClick={() => teken(true)} disabled={bezig || !png} className="btn-primary w-full">
                {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}Ondertekenen en volgende
              </button>
              <button type="button" onClick={() => teken(false)} disabled={bezig || !png} className="btn-secondary w-full text-sm">Ondertekenen en stoppen</button>
            </>
          ) : (
            <button type="button" onClick={() => teken(false)} disabled={bezig || !png} className="btn-primary w-full">
              {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <PenLine className="h-4 w-4" />}Ondertekenen
            </button>
          )}
        </div>
        <p className="text-[11px] text-gray-500">Staat het gele blok niet goed? Sleep het op de PDF naar de juiste plek (pagina {zone.page}).</p>
      </aside>
    </div>
  )
}

const BEWAAR = 'ngm.tegenteken.handtekening'

/** Eén PDF-pagina met het verplaatsbare vak voor onze handtekening. */
function PdfMetVak({ pdfUrl, zone, setZone, png, datum }: { pdfUrl: string | null; zone: OnsZone; setZone: (u: (z: OnsZone) => OnsZone) => void; png: string | null; datum: string }) {
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
              {/* Eén blok, zoals op de PDF: de handtekening en eronder datum en uur. */}
              <div onPointerDown={(e) => neer(e, 'move')} data-vak="ons"
                className="absolute rounded border-2 border-amber-500 bg-amber-100/60 flex flex-col cursor-move select-none"
                style={{ left: `${(zone.x / 100) * maten.wPx}px`, top: `${(zone.y / 100) * maten.hPx}px`, width: `${zone.w * schaal}px`, height: `${zone.h * schaal}px` }}>
                <div className="flex-1 min-h-0 flex items-end justify-center">
                  {png
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={png} alt="" className="max-w-full max-h-full object-contain pointer-events-none" />
                    : <span className="text-[10px] text-amber-900 font-semibold text-center px-1 self-center">✎ Handtekening NextGenMedia</span>}
                </div>
                <div className="shrink-0 flex items-center justify-center text-gray-800 leading-none whitespace-nowrap overflow-hidden pointer-events-none"
                  style={{ height: `${DATUM_HOOGTE * schaal}px`, fontSize: `${Math.max(7, 8 * schaal)}px` }}>{datum}</div>
                <span onPointerDown={(e) => neer(e, 'resize')} className="absolute -bottom-1 -right-1 h-3 w-3 bg-amber-600 rounded-sm cursor-se-resize" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
