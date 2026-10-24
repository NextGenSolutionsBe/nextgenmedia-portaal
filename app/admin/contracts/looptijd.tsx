'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, ChevronDown, Loader2 } from 'lucide-react'
import { LOOPTIJDEN, LOOPTIJD_INFO, looptijdVan, verdelingTekst, type Looptijd } from '@/lib/contracten/looptijd'

/**
 * Klikbare looptijdstatus (lopend / afgerond / stopgezet / verlopen).
 *
 * Eén klik opent de keuze, een tweede klik past de status meteen aan. Bij
 * "Stopgezet" kun je optioneel een stopdatum en reden invullen. Het menu staat
 * `fixed` zodat een tabel met horizontale scroll het nooit afknipt.
 */

export type LooptijdWaarde = { looptijd_status: Looptijd; stop_datum: string | null; stop_reden: string | null }

export function LooptijdChip({ status, klein }: { status: string | null | undefined; klein?: boolean }) {
  const l = looptijdVan(status)
  const i = LOOPTIJD_INFO[l]
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap ${klein ? 'px-1.5 py-0 text-[10px]' : 'px-2 py-0.5 text-[11px]'} ${i.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${i.stip}`} />{i.label}
    </span>
  )
}

export function LooptijdKiezer({
  contractId, waarde, onGewijzigd, groot,
}: {
  contractId: string
  waarde: { looptijd_status?: string | null; stop_datum?: string | null; stop_reden?: string | null }
  onGewijzigd?: (w: LooptijdWaarde) => void
  groot?: boolean
}) {
  const huidig = looptijdVan(waarde.looptijd_status)
  const [open, setOpen] = useState(false)
  const [stopForm, setStopForm] = useState<{ datum: string; reden: string } | null>(null)
  const [bezig, setBezig] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const knop = useRef<HTMLButtonElement>(null)
  const menu = useRef<HTMLDivElement>(null)
  const stopOpen = useRef(false)
  stopOpen.current = !!stopForm

  useEffect(() => {
    if (!open) return
    const sluit = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node
      if (menu.current?.contains(t) || knop.current?.contains(t)) return
      setOpen(false); setStopForm(null)
    }
    // Scrollen buiten het menu sluit het (anders zweeft het los van de knop).
    // Geen resize-luisteraar: op een gsm opent het toetsenbord bij het typen
    // van een reden, en dat mag het formulier niet sluiten.
    // Is het stopformulier open, dan sluit scrollen niets (de gsm scrollt zelf naar het invoerveld).
    const weg = (e: Event) => { if (stopOpen.current || menu.current?.contains(e.target as Node)) return; setOpen(false); setStopForm(null) }
    document.addEventListener('mousedown', sluit)
    document.addEventListener('touchstart', sluit)
    window.addEventListener('scroll', weg, true)
    return () => {
      document.removeEventListener('mousedown', sluit)
      document.removeEventListener('touchstart', sluit)
      window.removeEventListener('scroll', weg, true)
    }
  }, [open])

  const openen = (e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    const r = knop.current?.getBoundingClientRect()
    if (r) {
      const breedte = 256
      const left = Math.max(8, Math.min(r.left, window.innerWidth - breedte - 8))
      const top = r.bottom + 4 + 260 > window.innerHeight ? Math.max(8, r.top - 4 - 260) : r.bottom + 4
      setPos({ top, left })
    }
    setOpen((v) => !v); setStopForm(null)
  }

  const bewaar = async (status: Looptijd, extra?: { datum: string; reden: string }) => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/looptijd`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ looptijd_status: status, stop_datum: extra?.datum || null, stop_reden: extra?.reden || null }),
      })
      const j = await r.json(); if (!r.ok) throw new Error(j.error)
      onGewijzigd?.({ looptijd_status: j.looptijd_status, stop_datum: j.stop_datum ?? null, stop_reden: j.stop_reden ?? null })
      toast.success(`Status: ${LOOPTIJD_INFO[status].label}`)
      setOpen(false); setStopForm(null)
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Status aanpassen mislukt') } finally { setBezig(false) }
  }

  const kies = (l: Looptijd) => {
    if (l === 'stopgezet') { setStopForm({ datum: waarde.stop_datum ?? new Date().toISOString().slice(0, 10), reden: waarde.stop_reden ?? '' }); return }
    if (l === huidig) { setOpen(false); return }
    void bewaar(l)
  }

  const i = LOOPTIJD_INFO[huidig]
  return (
    <>
      <button
        ref={knop}
        type="button"
        onClick={openen}
        disabled={bezig}
        title={huidig === 'stopgezet' && (waarde.stop_reden || waarde.stop_datum) ? `Stopgezet${waarde.stop_datum ? ` op ${waarde.stop_datum.split('-').reverse().join('/')}` : ''}${waarde.stop_reden ? ` — ${waarde.stop_reden}` : ''}` : 'Klik om de status aan te passen'}
        className={`inline-flex items-center gap-1 rounded-full border font-medium whitespace-nowrap transition-shadow hover:shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-1 focus:ring-gray-300 ${groot ? 'px-2.5 py-1 text-xs' : 'px-2 py-0.5 text-[11px]'} ${i.chip}`}
      >
        {bezig ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className={`h-1.5 w-1.5 rounded-full ${i.stip}`} />}
        {i.label}
        <ChevronDown className="h-3 w-3 opacity-60" />
      </button>

      {open && pos && (
        <div ref={menu} style={{ top: pos.top, left: pos.left }} className="fixed z-[70] w-64 rounded-xl border border-gray-200 bg-white shadow-xl p-1.5 text-sm" onClick={(e) => e.stopPropagation()}>
          {!stopForm ? (
            LOOPTIJDEN.map((l) => (
              <button key={l} type="button" disabled={bezig} onClick={() => kies(l)} className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-gray-50 text-left">
                <span className={`h-2 w-2 rounded-full ${LOOPTIJD_INFO[l].stip}`} />
                <span className="flex-1">{LOOPTIJD_INFO[l].label}</span>
                {l === huidig && <Check className="h-3.5 w-3.5 text-gray-500" />}
              </button>
            ))
          ) : (
            <div className="p-2 space-y-2">
              <div className="text-xs font-semibold text-red-700">Contract stopzetten</div>
              <label className="block text-[11px] text-gray-600">Stopdatum <span className="text-gray-400">(optioneel)</span>
                <input type="date" className="mt-0.5 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={stopForm.datum} onChange={(e) => setStopForm({ ...stopForm, datum: e.target.value })} />
              </label>
              <label className="block text-[11px] text-gray-600">Reden <span className="text-gray-400">(optioneel)</span>
                <textarea rows={2} className="mt-0.5 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={stopForm.reden} onChange={(e) => setStopForm({ ...stopForm, reden: e.target.value })} placeholder="bv. klant stopt de samenwerking" />
              </label>
              <div className="flex gap-2 justify-end">
                <button type="button" onClick={() => setStopForm(null)} className="btn-secondary text-xs">Terug</button>
                <button type="button" disabled={bezig} onClick={() => void bewaar('stopgezet', stopForm)} className="btn-primary text-xs bg-red-600 hover:bg-red-700 text-white border-red-600">
                  {bezig && <Loader2 className="h-3 w-3 animate-spin" />}Stopzetten
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  )
}

/**
 * Compacte verdeling bij een klantmap: kleine gekleurde badges met aantallen.
 * Op desktop verschijnt de volledige verdeling als tooltip bij hover; op een
 * touchscherm (geen hover) opent een tik dezelfde uitleg.
 */
export function MapVerdeling({ verdeling }: { verdeling: Record<Looptijd, number> }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const sluit = (e: MouseEvent | TouchEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', sluit)
    document.addEventListener('touchstart', sluit)
    return () => { document.removeEventListener('mousedown', sluit); document.removeEventListener('touchstart', sluit) }
  }, [open])

  const aanwezig = LOOPTIJDEN.filter((l) => verdeling[l] > 0)
  if (aanwezig.length === 0) return null
  return (
    <span
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={`Verdeling: ${verdelingTekst(verdeling)}`}
      onClick={(e) => { e.stopPropagation(); setOpen((v) => !v) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v) } }}
      className="group relative inline-flex items-center gap-1 cursor-help"
    >
      {aanwezig.map((l) => (
        <span key={l} className={`inline-flex items-center gap-0.5 rounded-full border px-1.5 text-[10px] font-semibold leading-4 ${LOOPTIJD_INFO[l].chip}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${LOOPTIJD_INFO[l].stip}`} />{verdeling[l]}
        </span>
      ))}
      <span className={`absolute left-0 top-full mt-1.5 z-30 w-44 rounded-lg border border-gray-200 bg-white shadow-lg p-2 text-[11px] text-gray-700 ${open ? 'block' : 'hidden'} group-hover:block`}>
        <span className="block font-semibold text-gray-500 mb-1">Contracten per status</span>
        {LOOPTIJDEN.map((l) => (
          <span key={l} className="flex items-center justify-between gap-2 py-0.5">
            <span className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${LOOPTIJD_INFO[l].stip}`} />{LOOPTIJD_INFO[l].label}</span>
            <span className={`font-semibold ${verdeling[l] ? LOOPTIJD_INFO[l].tekst : 'text-gray-300'}`}>{verdeling[l]}</span>
          </span>
        ))}
      </span>
    </span>
  )
}

/** De kiezer op de detailpagina: na een wijziging de pagina (en tijdlijn) verversen. */
export function LooptijdDetail({ contractId, waarde }: { contractId: string; waarde: { looptijd_status?: string | null; stop_datum?: string | null; stop_reden?: string | null } }) {
  const router = useRouter()
  const [w, setW] = useState(waarde)
  useEffect(() => { setW(waarde) }, [waarde])
  const huidig = looptijdVan(w.looptijd_status)
  return (
    <span className="inline-flex items-center gap-2 flex-wrap">
      <LooptijdKiezer contractId={contractId} waarde={w} groot onGewijzigd={(n) => { setW(n); router.refresh() }} />
      {huidig === 'stopgezet' && (w.stop_datum || w.stop_reden) && (
        <span className="text-xs text-red-700">
          {w.stop_datum ? `Stopgezet op ${w.stop_datum.split('-').reverse().join('/')}` : 'Stopgezet'}{w.stop_reden ? ` — ${w.stop_reden}` : ''}
        </span>
      )}
    </span>
  )
}
