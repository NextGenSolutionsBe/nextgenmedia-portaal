'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { UserRound } from 'lucide-react'
import { VerantwoordelijkeKiezer } from '@/components/admin/verantwoordelijke-kiezer'
import type { ContractVerantwoordelijke } from '@/lib/contracten/verantwoordelijke'

/**
 * Wie is verantwoordelijk voor dit contract? Staat op de projectkaart; hier
 * zichtbaar en aan te passen. Die persoon volgt op en tekent namens ons tegen.
 */
export function ContractVerantwoordelijkeKaart({ contractId, begin }: { contractId: string; begin: ContractVerantwoordelijke | null }) {
  const router = useRouter()
  const [v, setV] = useState(begin)
  const [bezig, setBezig] = useState(false)

  const zet = async (nieuw: ContractVerantwoordelijke) => {
    if (nieuw === v) return
    setBezig(true)
    try {
      const r = await fetch('/api/admin/contracts/verantwoordelijke', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contract_id: contractId, verantwoordelijke: nieuw }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Bewaren mislukt')
      setV(nieuw)
      toast.success(`Verantwoordelijke: ${nieuw}`)
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Bewaren mislukt') } finally { setBezig(false) }
  }

  return (
    <div className={`rounded-xl border px-4 py-3 flex items-center gap-3 flex-wrap ${v ? 'border-gray-200 bg-white' : 'border-amber-300 bg-amber-50'}`}>
      <UserRound className={`h-4 w-4 shrink-0 ${v ? 'text-gray-400' : 'text-amber-700'}`} />
      <div className="flex-1 min-w-[200px]">
        <div className="text-sm font-medium text-gray-900" id="contract-verantwoordelijke-label">Verantwoordelijke{v ? `: ${v}` : ''}</div>
        <div className={`text-xs ${v ? 'text-gray-500' : 'text-amber-900'}`}>
          {v ? 'Volgt dit contract op en tekent namens ons tegen.' : 'Nog niemand gekozen. Kies wie dit contract opvolgt en tegentekent.'}
        </div>
      </div>
      <VerantwoordelijkeKiezer id="contract-verantwoordelijke" waarde={v} onChange={zet} bezig={bezig} />
    </div>
  )
}
