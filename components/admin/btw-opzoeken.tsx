'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Search, BadgeCheck } from 'lucide-react'
import { validateBtw, normalizeBtw, btwIsVolledig, inEuRegister } from '@/lib/btw'
import type { BtwGegevens } from '@/lib/btw-register'

// Wat we in deze sessie al vonden: hetzelfde nummer opnieuw = meteen.
const gevondenCache = new Map<string, BtwGegevens>()

type Resultaat = { voor: string; gegevens?: BtwGegevens; fout?: string }

/**
 * Knop "Gegevens opzoeken" bij een btw-veld: haalt naam en adres uit het
 * Europese btw-register (VIES). Zoekt vanzelf zodra het nummer volledig is,
 * hoe het ook getypt of geplakt werd ("BE 1016.637.895", "btw: 1016637895").
 * Wat je ermee doet (lege velden invullen), beslist het formulier via onGevonden.
 * Met onNetjes zet het veld na het vinden het nummer netjes (BE1016637895).
 * Een nummer dat er bij het openen al stond, zoekt het niet vanzelf op.
 */
export function BtwOpzoeken({ btw, onGevonden, onNetjes, auto = true }: {
  btw: string
  onGevonden: (g: BtwGegevens) => void
  onNetjes?: (netjes: string) => void
  auto?: boolean
}) {
  const [bezig, setBezig] = useState<string | null>(null)
  const [resultaat, setResultaat] = useState<Resultaat | null>(null)
  const begin = useRef(normalizeBtw(btw))
  const geprobeerd = useRef('')
  const lopend = useRef<AbortController | null>(null)
  const terug = useRef(onGevonden)
  terug.current = onGevonden
  const netjes = useRef(onNetjes)
  netjes.current = onNetjes

  const toepassen = (invoer: string, g: BtwGegevens) => {
    setResultaat({ voor: g.btw, gegevens: g })
    terug.current(g)
    if (netjes.current && invoer.trim() !== g.btw) netjes.current(g.btw)
  }

  const zoek = async (invoer: string) => {
    const v = validateBtw(invoer)
    if (!v.ok || !v.value) { setResultaat({ voor: v.value, fout: v.error ?? 'Vul een btw-nummer in.' }); return }
    if (!inEuRegister(v.value)) { setResultaat({ voor: v.value, fout: `${v.value.slice(0, 2)} zit niet in het Europese btw-register. Vul naam en adres zelf in.` }); return }
    const al = gevondenCache.get(v.value)
    if (al) { toepassen(invoer, al); return }
    lopend.current?.abort()
    const ctrl = new AbortController()
    lopend.current = ctrl
    setBezig(v.value)
    try {
      const r = await fetch(`/api/admin/btw-opzoeken?nummer=${encodeURIComponent(v.value)}`, { cache: 'no-store', signal: ctrl.signal })
      const j = await r.json().catch(() => ({}))
      if (ctrl.signal.aborted) return
      if (!r.ok) throw new Error(j.error || 'Opzoeken mislukt. Probeer het zo meteen opnieuw.')
      const g = j.gegevens as BtwGegevens
      gevondenCache.set(v.value, g)
      toepassen(invoer, g)
    } catch (e) {
      if (ctrl.signal.aborted) return
      setResultaat({ voor: v.value, fout: e instanceof Error ? e.message : 'Opzoeken mislukt' })
    } finally {
      if (lopend.current === ctrl) { lopend.current = null; setBezig(null) }
    }
  }

  // Vanzelf opzoeken zodra er een volledig, geldig nummer staat.
  useEffect(() => {
    const nu = normalizeBtw(btw)
    if (nu !== begin.current) begin.current = ''
    if (!btwIsVolledig(btw)) { geprobeerd.current = ''; return }
    if (!auto || nu === begin.current || nu === geprobeerd.current) return
    const t = setTimeout(() => { geprobeerd.current = nu; void zoek(btw) }, gevondenCache.has(nu) ? 0 : 250)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btw, auto])

  useEffect(() => () => lopend.current?.abort(), [])

  const nu = normalizeBtw(btw)
  const toon = resultaat && resultaat.voor === nu ? resultaat : null
  // Volledig getypt maar fout (bv. een cijfer verkeerd): meteen zeggen, zonder klik.
  const cijfers = btw.replace(/\D/g, '').length
  const directeFout = !toon && !bezig && nu.startsWith('BE') && cijfers >= 10 ? validateBtw(btw).error : undefined
  const isBezig = bezig !== null && bezig === nu

  return (
    <div className="mt-1 space-y-1">
      <button type="button" onClick={() => { geprobeerd.current = nu; void zoek(btw) }} disabled={isBezig || !btw.trim()} className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 underline underline-offset-2 disabled:no-underline disabled:text-gray-400">
        {isBezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}{isBezig ? 'Opzoeken in het btw-register…' : 'Gegevens opzoeken'}
      </button>
      {toon?.gegevens && !isBezig && (
        <p className="text-xs text-green-800 flex gap-1"><BadgeCheck className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span>Gevonden: <b>{toon.gegevens.naam}</b>{toon.gegevens.straat ? ` · ${toon.gegevens.straat}` : ''}{toon.gegevens.postcode || toon.gegevens.gemeente ? `, ${[toon.gegevens.postcode, toon.gegevens.gemeente].filter(Boolean).join(' ')}` : ''}</span>
        </p>
      )}
      {toon?.fout && !isBezig && <p className="text-xs text-red-700" role="alert">{toon.fout}</p>}
      {directeFout && <p className="text-xs text-amber-700">{directeFout}</p>}
    </div>
  )
}
