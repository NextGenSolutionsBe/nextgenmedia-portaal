'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Pencil, Tag } from 'lucide-react'
import { ContracttypeKiezer } from '../contracttype-kiezer'
import { typeVanContract, gelijkType, isNietToegewezen } from '@/lib/contracten/types'

/**
 * Contracttype op de detailpagina tonen en inline aanpassen.
 * Bewaart via PATCH /api/admin/contracts/<id> met action 'contract_type'.
 */
export function ContracttypeBewerker({ contractId, initieel }: { contractId: string; initieel: string | null }) {
  const router = useRouter()
  const huidig = typeVanContract(initieel)
  const [bewerken, setBewerken] = useState(false)
  const [waarde, setWaarde] = useState(huidig)
  const [bezig, setBezig] = useState(false)

  const bewaren = async () => {
    if (bezig) return
    if (gelijkType(waarde, huidig)) { setBewerken(false); return }
    setBezig(true)
    try {
      const res = await fetch(`/api/admin/contracts/${contractId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'contract_type', contract_type: waarde }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || 'Opslaan mislukt')
      toast.success(`Contracttype gewijzigd naar "${j.contract_type ?? waarde}".`)
      setBewerken(false)
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Opslaan mislukt')
    } finally { setBezig(false) }
  }

  if (!bewerken) {
    return (
      <div className="flex items-center justify-between gap-2">
        <span className="text-gray-500">Contracttype:</span>
        <button
          type="button"
          onClick={() => { setWaarde(huidig); setBewerken(true) }}
          className="group inline-flex items-center gap-1.5 text-right min-w-0 hover:text-black"
          title="Contracttype aanpassen"
        >
          <Tag className={`h-3.5 w-3.5 shrink-0 ${isNietToegewezen(huidig) ? 'text-amber-500' : 'text-gray-400'}`} />
          <span className={`truncate ${isNietToegewezen(huidig) ? 'text-amber-600' : ''}`}>{huidig}</span>
          <Pencil className="h-3 w-3 shrink-0 text-gray-300 group-hover:text-gray-600" />
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <span className="text-gray-500 block">Contracttype</span>
      <ContracttypeKiezer waarde={waarde} onWijzig={setWaarde} />
      <div className="flex gap-2">
        <button type="button" onClick={() => void bewaren()} disabled={bezig} className="btn-primary text-xs px-3 py-1.5">
          {bezig && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Opslaan
        </button>
        <button type="button" onClick={() => { setBewerken(false); setWaarde(huidig) }} disabled={bezig} className="btn-secondary text-xs px-3 py-1.5">
          Annuleer
        </button>
      </div>
    </div>
  )
}
