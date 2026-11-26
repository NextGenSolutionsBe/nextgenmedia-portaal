'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { BEDRIJF_FILTERS, type BedrijfFilter } from '@/lib/bedrijven/model'
import { cn } from '@/lib/utils'

/**
 * Eigen weergave: Alles, Media of Solutions. Filtert de lijsten en het
 * Command Center op het bedrijf; "Algemeen" en wat nog geen bedrijf heeft,
 * blijft overal zichtbaar. Enkel voor jezelf, onthouden per gebruiker.
 */
export function BedrijfSchakelaar({ huidig }: { huidig: BedrijfFilter }) {
  const router = useRouter()
  const [keuze, setKeuze] = useState<BedrijfFilter>(huidig)
  const [, start] = useTransition()

  const kies = async (b: BedrijfFilter) => {
    if (b === keuze) return
    const vorige = keuze
    setKeuze(b)
    try {
      const r = await fetch('/api/admin/bedrijven', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'weergave', bedrijf: b }) })
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Bewaren mislukt')
      start(() => router.refresh())
    } catch (e) {
      setKeuze(vorige)
      toast.error(e instanceof Error ? e.message : 'Bewaren mislukt')
    }
  }

  return (
    <div role="radiogroup" aria-label="Weergave per bedrijf" className="mx-3 mb-1 grid grid-cols-3 gap-0.5 p-0.5 rounded-xl bg-white/50 border border-white/80">
      {BEDRIJF_FILTERS.map((f) => (
        <button key={f.key} type="button" role="radio" aria-checked={keuze === f.key} onClick={() => kies(f.key)}
          className={cn('py-1 rounded-lg text-[11px] font-medium transition-colors',
            keuze === f.key ? (f.key === 'nextgensolutions' ? 'bg-blue-600 text-white' : 'bg-black text-white') : 'text-gray-500 hover:text-gray-900 hover:bg-white/70')}>
          {f.label}
        </button>
      ))}
    </div>
  )
}
