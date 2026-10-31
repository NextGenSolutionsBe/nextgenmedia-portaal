'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Search, BadgeCheck } from 'lucide-react'
import { validateBtw } from '@/lib/btw'
import type { BtwGegevens } from '@/lib/btw-register'

/**
 * Knop "Opzoeken" bij een btw-veld: haalt naam en adres uit het Europese
 * btw-register (VIES). Zoekt ook vanzelf zodra het nummer klopt. Wat je
 * ermee doet (lege velden invullen), beslist het formulier via onGevonden.
 */
export function BtwOpzoeken({ btw, onGevonden, auto = true }: { btw: string; onGevonden: (g: BtwGegevens) => void; auto?: boolean }) {
  const [bezig, setBezig] = useState(false)
  const [gevonden, setGevonden] = useState<BtwGegevens | null>(null)
  const [fout, setFout] = useState<string | null>(null)
  const laatste = useRef('')
  const terug = useRef(onGevonden)
  terug.current = onGevonden

  const zoek = async (nummer: string) => {
    const v = validateBtw(nummer)
    if (!v.ok || !v.value) { setFout(v.error ?? 'Vul een btw-nummer in.'); setGevonden(null); return }
    laatste.current = v.value
    setBezig(true); setFout(null)
    try {
      const r = await fetch(`/api/admin/btw-opzoeken?nummer=${encodeURIComponent(v.value)}`, { cache: 'no-store' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Opzoeken mislukt')
      if (laatste.current !== v.value) return
      setGevonden(j.gegevens as BtwGegevens)
      terug.current(j.gegevens as BtwGegevens)
    } catch (e) { setGevonden(null); setFout(e instanceof Error ? e.message : 'Opzoeken mislukt') } finally { setBezig(false) }
  }

  // Vanzelf opzoeken zodra er een volledig, geldig nummer staat.
  useEffect(() => {
    if (!auto) return
    const v = validateBtw(btw)
    if (!v.ok || !v.value || v.value.length < 10 || v.value === laatste.current) return
    const t = setTimeout(() => { void zoek(btw) }, 500)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [btw, auto])

  return (
    <div className="mt-1 space-y-1">
      <button type="button" onClick={() => void zoek(btw)} disabled={bezig || !btw.trim()} className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 underline underline-offset-2 disabled:no-underline disabled:text-gray-400">
        {bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}{bezig ? 'Opzoeken in het btw-register…' : 'Gegevens opzoeken'}
      </button>
      {gevonden && !bezig && (
        <p className="text-xs text-green-800 flex gap-1"><BadgeCheck className="h-3.5 w-3.5 shrink-0 mt-px" />
          <span>Gevonden: <b>{gevonden.naam}</b>{gevonden.straat ? ` · ${gevonden.straat}` : ''}{gevonden.postcode || gevonden.gemeente ? `, ${[gevonden.postcode, gevonden.gemeente].filter(Boolean).join(' ')}` : ''}</span>
        </p>
      )}
      {fout && !bezig && <p className="text-xs text-red-700" role="alert">{fout}</p>}
    </div>
  )
}
