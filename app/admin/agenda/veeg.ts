'use client'

import { useEffect, useRef } from 'react'
import { wiel, vingerRichting, vingerStap, vingerMee, type WielStand } from '@/lib/agenda/veeg'
import { agendaSleep } from './kalender'

/** Kan iets tussen het doel en de kalender zelf opzij scrollen in die richting? Dan laten we dat scrollen. */
function scrolltZelf(doel: EventTarget | null, wortel: HTMLElement, dx: number): boolean {
  let el = doel instanceof Element ? doel : null
  while (el && el !== wortel) {
    if (el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1) {
      const ov = getComputedStyle(el).overflowX
      if (ov === 'auto' || ov === 'scroll') {
        if (dx > 0 && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) return true
        if (dx < 0 && el.scrollLeft > 0) return true
      }
    }
    el = el.parentElement
  }
  return false
}

/** Een invulveld, venster of menu: daar is vegen geen periode wisselen. */
const nietHier = (doel: EventTarget | null) => doel instanceof Element && !!doel.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [data-geen-veeg]')

/**
 * Vegen door de agenda: twee vingers opzij op de touchpad (laptop) of één vinger (gsm).
 * De kalender schuift mee terwijl je veegt en springt dan naar de vorige of volgende
 * periode; niet ver genoeg = terugveren. Niet tijdens het verslepen van een blok.
 */
export function useVeeg(el: HTMLElement | null, opts: { actief: boolean; stap: (n: 1 | -1) => void }) {
  const laatst = useRef(opts)
  laatst.current = opts

  useEffect(() => {
    if (!el) return
    let wielStand: WielStand | null = null
    let terugTimer: ReturnType<typeof setTimeout> | null = null

    const zet = (px: number, glad = false) => {
      el.style.transition = glad ? 'transform 180ms ease-out' : 'none'
      el.style.transform = px ? `translateX(${px}px)` : ''
    }
    const verder = (n: 1 | -1) => {
      zet(0)
      laatst.current.stap(n)
      // De nieuwe periode komt van de kant waar je naartoe veegde.
      try { el.animate([{ transform: `translateX(${n * 48}px)`, opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 200, easing: 'cubic-bezier(.2,.8,.2,1)' }) } catch { /* oudere browser */ }
    }
    const magNu = () => laatst.current.actief && !agendaSleep.bezig && Date.now() - agendaSleep.tot > 400

    // ── Touchpad (laptop): wheel met deltaX ───────────────────────────────
    const opWiel = (e: WheelEvent) => {
      if (e.ctrlKey || !magNu()) return // ctrl = inzoomen met twee vingers
      const f = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientWidth : 1
      const dx = e.deltaX * f, dy = e.deltaY * f
      if (!wielStand && (Math.abs(dx) <= Math.abs(dy) || nietHier(e.target) || scrolltZelf(e.target, el, dx))) return
      const r = wiel(wielStand, dx, dy, performance.now())
      wielStand = r.s
      if (!r.vang) return
      e.preventDefault() // geen "vorige pagina" van de browser en niet de pagina opzij
      if (r.stap) { verder(r.stap); return }
      zet(r.mee)
      // Vingers los zonder genoeg te vegen: terugveren.
      if (terugTimer) clearTimeout(terugTimer)
      terugTimer = setTimeout(() => { if (wielStand && !wielStand.vast) zet(0, true); wielStand = null }, 240)
    }

    // ── Vinger (gsm) ───────────────────────────────────────────────────────
    let vinger: { x: number; y: number; t: number; richting: 'opzij' | 'scroll' | null; dx: number } | null = null
    const opStart = (e: TouchEvent) => {
      if (e.touches.length !== 1 || !magNu() || nietHier(e.target)) { vinger = null; return }
      const t = e.touches[0]
      vinger = { x: t.clientX, y: t.clientY, t: performance.now(), richting: null, dx: 0 }
    }
    const opBeweeg = (e: TouchEvent) => {
      if (!vinger || e.touches.length !== 1) return
      if (agendaSleep.bezig) { vinger = null; zet(0, true); return } // een blok wordt versleept
      const t = e.touches[0]
      const dx = t.clientX - vinger.x, dy = t.clientY - vinger.y
      if (!vinger.richting) {
        vinger.richting = vingerRichting(dx, dy)
        if (vinger.richting === 'opzij' && scrolltZelf(e.target, el, -dx)) vinger.richting = 'scroll'
      }
      if (vinger.richting !== 'opzij') return
      if (e.cancelable) e.preventDefault() // niet tegelijk op en neer scrollen
      vinger.dx = dx
      zet(vingerMee(dx))
    }
    const opEind = () => {
      const v = vinger
      vinger = null
      if (!v || v.richting !== 'opzij') return
      const n = vingerStap(v.dx, performance.now() - v.t)
      if (n) verder(n); else zet(0, true)
    }
    const opAnnuleer = () => { if (vinger?.richting === 'opzij') zet(0, true); vinger = null }

    el.addEventListener('wheel', opWiel, { passive: false })
    el.addEventListener('touchstart', opStart, { passive: true })
    el.addEventListener('touchmove', opBeweeg, { passive: false })
    el.addEventListener('touchend', opEind)
    el.addEventListener('touchcancel', opAnnuleer)
    return () => {
      if (terugTimer) clearTimeout(terugTimer)
      el.removeEventListener('wheel', opWiel)
      el.removeEventListener('touchstart', opStart)
      el.removeEventListener('touchmove', opBeweeg)
      el.removeEventListener('touchend', opEind)
      el.removeEventListener('touchcancel', opAnnuleer)
      el.style.transform = ''
      el.style.transition = ''
    }
  }, [el])
}
