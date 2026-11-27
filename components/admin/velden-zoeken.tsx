'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Loader2, RotateCw, Settings2 } from 'lucide-react'

/**
 * Een opgeladen contract zonder velden: meteen de invulvelden en de handtekeningzones
 * laten zoeken (AI + exact op de lijnen van de pdf), zonder dat iemand eerst naar
 * "AI-velden & zone" moet. Daarna één regel met hoeveel er klaarstaan en Nakijken.
 */
export function VeldenZoeken({ contractId, nodig }: { contractId: string; nodig: boolean }) {
  const router = useRouter()
  const [stand, setStand] = useState<'bezig' | 'klaar' | 'fout' | null>(nodig ? 'bezig' : null)
  const [aantal, setAantal] = useState(0)
  const [fout, setFout] = useState<string | null>(null)
  const gestart = useRef(false)

  const zoek = async () => {
    setStand('bezig'); setFout(null)
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/analyze?vanzelf=1`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error || 'Velden zoeken mislukt')
      setAantal((j.fields ?? []).length); setStand('klaar')
      router.refresh()
    } catch (e) { setFout(e instanceof Error ? e.message : 'Velden zoeken mislukt'); setStand('fout') }
  }
  useEffect(() => {
    if (!nodig || gestart.current) return
    gestart.current = true
    void zoek()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodig])

  if (!stand) return null
  return (
    <div className="rounded-xl border border-gray-200 bg-white px-4 py-3 text-sm flex items-center gap-3 flex-wrap">
      {stand === 'bezig' && <><Loader2 className="h-4 w-4 animate-spin text-gray-500" /><span className="text-gray-700">De invulvelden en handtekeningen worden in de pdf gezocht…</span></>}
      {stand === 'klaar' && <><CheckCircle2 className="h-4 w-4 text-green-600" /><span className="text-gray-800 flex-1">{aantal ? `${aantal} ${aantal === 1 ? 'veld staat' : 'velden staan'} klaar, samen met de handtekeningen.` : 'De handtekeningen staan klaar; in de pdf staan geen invulvelden.'}</span>
        <Link href={`/admin/contracts/${contractId}/setup`} className="btn-secondary !py-1.5 !text-xs"><Settings2 className="h-3.5 w-3.5" />Nakijken</Link></>}
      {stand === 'fout' && <><span className="text-gray-700 flex-1">Velden zoeken lukte niet{fout ? `: ${fout}` : ''}.</span>
        <button type="button" onClick={zoek} className="btn-secondary !py-1.5 !text-xs"><RotateCw className="h-3.5 w-3.5" />Opnieuw</button>
        <Link href={`/admin/contracts/${contractId}/setup`} className="btn-secondary !py-1.5 !text-xs"><Settings2 className="h-3.5 w-3.5" />Zelf instellen</Link></>}
    </div>
  )
}
