'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Building2 } from 'lucide-react'
import { BedrijfKiezer, BedrijfLabel } from '@/components/admin/bedrijf-kiezer'

/**
 * Voor welk bedrijf is dit (verbeterplan fase 1)? Groot bovenaan een contract
 * (of een ander record), met de keuze erbij. Aanpassen wordt gelogd en geeft
 * het bedrijf door aan wat ervan afhangt dat nog geen bedrijf heeft
 * (bv. de facturen van een contract).
 */
export function RecordBedrijfKaart({ tabel, id, begin, magAanpassen = true }: { tabel: 'contracts' | 'opdrachten' | 'invoices'; id: string; begin: string | null; magAanpassen?: boolean }) {
  const router = useRouter()
  const [b, setB] = useState(begin)
  const [open, setOpen] = useState(!begin && magAanpassen)
  const [bezig, setBezig] = useState(false)

  const zet = async (nieuw: string) => {
    if (nieuw === b) { setOpen(false); return }
    setBezig(true)
    try {
      const r = await fetch('/api/admin/bedrijven', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actie: 'zet', tabel, id, veld: 'bedrijf', keuze: nieuw }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      setB(nieuw); setOpen(false)
      toast.success('Bedrijf bewaard.')
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }

  return (
    <div className={`rounded-xl border px-4 py-3 ${b ? 'border-gray-200 bg-white' : 'border-amber-300 bg-amber-50'}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <Building2 className={`h-4 w-4 shrink-0 ${b ? 'text-gray-400' : 'text-amber-700'}`} />
        <div className="flex-1 min-w-[200px] flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-gray-900">Bedrijf</span>
          <BedrijfLabel bedrijf={b} groot />
          {!b && <span className="text-xs text-amber-900">Nog niet gekozen.</span>}
        </div>
        {magAanpassen && !open && <button type="button" className="btn-secondary !py-1 !text-xs" onClick={() => setOpen(true)}>Aanpassen</button>}
      </div>
      {open && (
        <div className="mt-3">
          <BedrijfKiezer waarde={b} onChange={zet} disabled={bezig} />
          {b && <button type="button" className="text-xs text-gray-500 hover:underline mt-2" onClick={() => setOpen(false)}>Annuleren</button>}
        </div>
      )}
    </div>
  )
}
