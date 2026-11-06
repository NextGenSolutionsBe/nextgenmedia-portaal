'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Pencil, CalendarRange } from 'lucide-react'
import { formatDate } from '@/lib/utils'

/**
 * Start- en einddatum van een contract tonen en inline aanpassen.
 * Bewaart via PATCH /api/admin/contracts/<id> met action 'looptijd_datums'.
 * Een lege einddatum = onbepaalde duur.
 */
export function LooptijdDatums({ contractId, start, eind }: { contractId: string; start: string | null; eind: string | null }) {
  const router = useRouter()
  const s0 = start ? start.slice(0, 10) : ''
  const e0 = eind ? eind.slice(0, 10) : ''
  const [bewerken, setBewerken] = useState(false)
  const [s, setS] = useState(s0)
  const [e, setE] = useState(e0)
  const [bezig, setBezig] = useState(false)
  const fout = s && e && e < s ? 'De einddatum ligt vóór de startdatum.' : null

  const bewaren = async () => {
    if (bezig || fout) return
    if (s === s0 && e === e0) { setBewerken(false); return }
    setBezig(true)
    try {
      const res = await fetch(`/api/admin/contracts/${contractId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'looptijd_datums', start_date: s || null, end_date: e || null }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Opslaan mislukt')
      toast.success('Start- en einddatum bewaard.')
      setBewerken(false)
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Opslaan mislukt')
    } finally { setBezig(false) }
  }

  if (!bewerken) {
    return (
      <button type="button" onClick={() => { setS(s0); setE(e0); setBewerken(true) }} className="group w-full space-y-2 text-left" title="Start- en einddatum aanpassen">
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-500">Startdatum:</span>
          <span className="inline-flex items-center gap-1.5 group-hover:text-black">{s0 ? formatDate(s0) : <span className="text-gray-400">niet ingevuld</span>}<Pencil className="h-3 w-3 text-gray-300 group-hover:text-gray-600" /></span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <span className="text-gray-500">Einddatum:</span>
          <span className="inline-flex items-center gap-1.5 group-hover:text-black">{e0 ? formatDate(e0) : <span className="text-gray-400">onbepaalde duur</span>}<Pencil className="h-3 w-3 text-gray-300 group-hover:text-gray-600" /></span>
        </div>
      </button>
    )
  }

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-2.5">
      <div className="text-xs font-medium text-gray-600 flex items-center gap-1"><CalendarRange className="h-3.5 w-3.5" />Looptijd van het contract</div>
      <label className="block text-xs text-gray-500">Startdatum
        <input type="date" className="mt-0.5 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={s} onChange={(ev) => setS(ev.target.value)} />
      </label>
      <label className="block text-xs text-gray-500">Einddatum <span className="text-gray-400">(leeg = onbepaalde duur)</span>
        <input type="date" min={s || undefined} className="mt-0.5 w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" value={e} onChange={(ev) => setE(ev.target.value)} />
      </label>
      {fout && <div className="text-xs text-red-600">{fout}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={() => setBewerken(false)} className="btn-secondary text-xs" disabled={bezig}>Annuleren</button>
        <button type="button" onClick={bewaren} className="btn-primary text-xs" disabled={bezig || !!fout}>{bezig && <Loader2 className="h-3 w-3 animate-spin" />}Bewaren</button>
      </div>
    </div>
  )
}
