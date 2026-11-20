'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialoog } from '@/app/admin/instellingen/ui'
import { bepaalBuren, leesNavigatie, isTekstInvoer, swipeRichting, type Buren } from '@/lib/contract-navigatie'
import { heeftVuil, vuileInzendingen, slaAllesOp, luisterNaarVuil } from '@/lib/vuil-register'

/**
 * ← Vorig contract / Volgend contract → in de detailweergave.
 * Volgorde en filters komen uit het overzicht (sessionStorage); zonder die
 * context geldt de standaardvolgorde via een kleine API. Elke navigatie is
 * een gewone paginawissel, dus toegangsrechten worden per contract opnieuw
 * gecontroleerd door middleware en pagina.
 */
export function ContractNavigatie({ contractId }: { contractId: string }) {
  const router = useRouter()
  const [buren, setBuren] = useState<Buren | null>(null)
  const [bron, setBron] = useState<'overzicht' | 'standaard' | null>(null)
  const [bezig, setBezig] = useState<string | null>(null)
  const [vraag, setVraag] = useState<{ doel: string } | null>(null)
  const [opslaanBezig, setOpslaanBezig] = useState(false)
  const [vuil, setVuil] = useState(false)
  const slot = useRef(false)

  // Buren bepalen: eerst het overzicht in de sessie, anders de standaardvolgorde.
  useEffect(() => {
    let actief = true
    slot.current = false; setBezig(null)
    const nav = leesNavigatie()
    if (nav && nav.ids.includes(contractId)) { setBuren(bepaalBuren(nav.ids, contractId)); setBron('overzicht'); return }
    fetch(`/api/admin/contracts/navigatie?id=${contractId}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => { if (actief && !j.error) { setBuren({ vorige: j.vorige, volgende: j.volgende, index: j.index, totaal: j.totaal }); setBron('standaard') } })
      .catch(() => {})
    return () => { actief = false }
  }, [contractId])

  // Vooraf laden van de buren zodat de wissel meteen is.
  useEffect(() => {
    if (buren?.vorige) router.prefetch(`/admin/contracts/${buren.vorige}`)
    if (buren?.volgende) router.prefetch(`/admin/contracts/${buren.volgende}`)
  }, [buren, router])

  useEffect(() => { setVuil(heeftVuil()); return luisterNaarVuil(() => setVuil(heeftVuil())) }, [])

  const doe = useCallback((doel: string) => {
    if (slot.current) return                     // herhaald klikken opent nooit twee contracten
    slot.current = true; setBezig(doel)
    router.push(`/admin/contracts/${doel}`)
  }, [router])

  const navigeer = useCallback((doel: string | null) => {
    if (!doel || slot.current) return
    if (heeftVuil()) { setVraag({ doel }); return }
    doe(doel)
  }, [doe])

  // Toetsenbord: ← / →, behalve tijdens typen, met een open venster, of met open wijzigingen.
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return
      if (isTekstInvoer(e.target as Element | null) || isTekstInvoer(document.activeElement)) return
      if (document.querySelector('[aria-modal="true"], [role="dialog"], .fixed.inset-0')) return
      if (heeftVuil()) return
      if (e.key === 'ArrowLeft' && buren?.vorige) { e.preventDefault(); navigeer(buren.vorige) }
      if (e.key === 'ArrowRight' && buren?.volgende) { e.preventDefault(); navigeer(buren.volgende) }
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [buren, navigeer])

  // Veeg op mobiel: naar links = volgende, naar rechts = vorige.
  useEffect(() => {
    let start: { x: number; y: number; ok: boolean } | null = null
    const begin = (e: TouchEvent) => {
      const t = e.touches[0]; const doel = e.target as Element | null
      const geblokkeerd = !!doel?.closest?.('input, textarea, select, iframe, [data-geen-swipe]') || !!document.querySelector('[aria-modal="true"], [role="dialog"], .fixed.inset-0')
      start = { x: t.clientX, y: t.clientY, ok: !geblokkeerd }
    }
    const einde = (e: TouchEvent) => {
      if (!start?.ok) { start = null; return }
      const t = e.changedTouches[0]
      const richting = swipeRichting(t.clientX - start.x, t.clientY - start.y)
      start = null
      if (richting === 'links') navigeer(buren?.volgende ?? null)
      if (richting === 'rechts') navigeer(buren?.vorige ?? null)
    }
    document.addEventListener('touchstart', begin, { passive: true })
    document.addEventListener('touchend', einde, { passive: true })
    return () => { document.removeEventListener('touchstart', begin); document.removeEventListener('touchend', einde) }
  }, [buren, navigeer])

  const opslaanEnDoorgaan = async () => {
    if (!vraag) return
    setOpslaanBezig(true)
    try {
      const ok = await slaAllesOp()
      if (!ok) { toast.error('Opslaan is niet gelukt. Controleer het formulier en probeer opnieuw.'); return }
      const doel = vraag.doel; setVraag(null); doe(doel)
    } finally { setOpslaanBezig(false) }
  }

  const knop = 'btn-secondary text-xs px-2.5 disabled:opacity-40 disabled:cursor-not-allowed'
  const alleenAnnuleren = vuileInzendingen().some((i) => !i.opslaan)

  return (
    <div className="flex items-center gap-1.5 shrink-0" aria-label="Navigatie tussen contracten">
      <button type="button" onClick={() => navigeer(buren?.vorige ?? null)} disabled={!buren?.vorige || !!bezig} className={knop} title="Vorig contract (←)">
        {bezig && bezig === buren?.vorige ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronLeft className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">Vorig contract</span>
      </button>
      {buren && buren.index > 0 && (
        <span className="text-[11px] text-gray-500 tabular-nums whitespace-nowrap" title={bron === 'overzicht' ? 'Volgorde en filters van het overzicht' : 'Standaardvolgorde (nieuwste eerst)'}>
          {buren.index} van {buren.totaal}{vuil ? ' · niet opgeslagen' : ''}
        </span>
      )}
      <button type="button" onClick={() => navigeer(buren?.volgende ?? null)} disabled={!buren?.volgende || !!bezig} className={knop} title="Volgend contract (→)">
        <span className="hidden sm:inline">Volgend contract</span>
        {bezig && bezig === buren?.volgende ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
      </button>

      {vraag && (
        <Dialoog titel="Niet-opgeslagen wijzigingen" onSluit={() => setVraag(null)}>
          <p className="text-sm text-gray-700">Je hebt niet-opgeslagen wijzigingen. Wil je deze opslaan voordat je naar een ander contract gaat?</p>
          <ul className="mt-2 text-xs text-gray-500 list-disc ml-5">{vuileInzendingen().map((i) => <li key={i.naam}>{i.naam}{!i.opslaan ? ' (kan niet automatisch opgeslagen worden)' : ''}</li>)}</ul>
          <div className="flex flex-wrap gap-2 justify-end pt-5">
            <button type="button" onClick={() => setVraag(null)} className="btn-secondary" disabled={opslaanBezig}>Annuleren</button>
            <button type="button" onClick={() => { const doel = vraag.doel; setVraag(null); doe(doel) }} className="btn-secondary text-red-600" disabled={opslaanBezig}>Zonder opslaan doorgaan</button>
            <button type="button" onClick={opslaanEnDoorgaan} className="btn-primary" disabled={opslaanBezig || alleenAnnuleren} title={alleenAnnuleren ? 'Eén van de openstaande onderdelen kan niet automatisch opgeslagen worden.' : undefined}>
              {opslaanBezig && <Loader2 className="h-4 w-4 animate-spin" />}Opslaan en doorgaan
            </button>
          </div>
        </Dialoog>
      )}
    </div>
  )
}
