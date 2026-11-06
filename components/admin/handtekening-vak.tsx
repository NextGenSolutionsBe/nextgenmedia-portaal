'use client'

import { useEffect, useRef, useState } from 'react'
import { RotateCcw } from 'lucide-react'

/**
 * Een vak om met muis, vinger of pen te tekenen. Geeft de handtekening door als
 * PNG (data-URL), of null zolang er niets getekend is. Met `beginWaarde` staat
 * er al een handtekening in (bv. die van daarnet), die je kan wissen.
 */
export function HandtekeningVak({ onChange, beginWaarde = null, hoogte = 160 }: {
  onChange: (png: string | null) => void
  beginWaarde?: string | null
  hoogte?: number
}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const tekent = useRef(false)
  const heeftIets = useRef(!!beginWaarde)
  const [leeg, setLeeg] = useState(!beginWaarde)

  useEffect(() => {
    const c = ref.current
    const ctx = c?.getContext('2d')
    if (!c || !ctx) return
    ctx.strokeStyle = '#111'
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    if (beginWaarde) {
      const img = new Image()
      img.onload = () => { ctx.drawImage(img, 0, 0, c.width, c.height); onChange(beginWaarde) }
      img.src = beginWaarde
    }
    // Enkel bij het openen; de beginwaarde verandert daarna niet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const punt = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = ref.current!
    const r = c.getBoundingClientRect()
    return { x: (e.clientX - r.left) * (c.width / r.width), y: (e.clientY - r.top) * (c.height / r.height) }
  }
  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    ref.current!.setPointerCapture(e.pointerId)
    const p = punt(e)
    ctx.beginPath(); ctx.moveTo(p.x, p.y)
    tekent.current = true
  }
  const beweeg = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!tekent.current) return
    e.preventDefault()
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    const p = punt(e)
    ctx.lineTo(p.x, p.y); ctx.stroke()
    if (!heeftIets.current) { heeftIets.current = true; setLeeg(false) }
  }
  const stop = () => {
    if (!tekent.current) return
    tekent.current = false
    if (heeftIets.current && ref.current) onChange(ref.current.toDataURL('image/png'))
  }
  const wis = () => {
    const c = ref.current
    c?.getContext('2d')?.clearRect(0, 0, c.width, c.height)
    heeftIets.current = false
    setLeeg(true)
    onChange(null)
  }

  return (
    <div>
      <div className={`relative rounded-xl border bg-white touch-none ${leeg ? 'border-dashed border-gray-300' : 'border-gray-900'}`}>
        <canvas ref={ref} width={700} height={Math.round(hoogte * (700 / 420))} className="w-full cursor-crosshair rounded-xl" style={{ touchAction: 'none', height: hoogte }}
          onPointerDown={start} onPointerMove={beweeg} onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop} aria-label="Handtekening" />
        {leeg && <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs text-gray-400">Teken hier je handtekening</span>}
      </div>
      {!leeg && (
        <button type="button" onClick={wis} className="mt-1.5 inline-flex items-center gap-1 text-xs text-gray-500 hover:text-black">
          <RotateCcw className="h-3 w-3" />Opnieuw
        </button>
      )}
    </div>
  )
}
