'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Loader2, Receipt, AlertTriangle, CheckCircle2, RefreshCw } from 'lucide-react'

type Laatste = { sync_status: 'ok' | 'onvolledig' | 'fout'; fout: string | null; details: { samenvatting?: string; opmerkingen?: string[]; ontbreekt?: string[] } | null; created_at: string } | null

/**
 * Facturen uit het getekende contract: wat de app automatisch plande bij het
 * tekenen, of wat er nog ontbreekt. "Facturen plannen" probeert het (opnieuw);
 * een contract dat al facturen heeft, krijgt er nooit dubbel bij.
 */
export function FacturenUitContract({ contractId }: { contractId: string }) {
  const router = useRouter()
  const [laatste, setLaatste] = useState<Laatste>(null)
  const [facturen, setFacturen] = useState<number | null>(null)
  const [bezig, setBezig] = useState(false)

  const laad = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/facturen-plannen`, { cache: 'no-store' })
      const j = await r.json()
      if (r.ok) { setLaatste(j.laatste); setFacturen(j.facturen) }
    } catch { /* blok is een extra */ }
  }, [contractId])
  useEffect(() => { laad() }, [laad])

  const plan = async () => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/contracts/${contractId}/facturen-plannen`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || 'Plannen mislukt.')
      if (j.status === 'gepland') toast.success(`Gepland: ${j.samenvatting}. Ze staan bij Te factureren.`)
      else if (j.status === 'al_gepland') toast.info('Dit contract heeft al facturen. Er is niets bijgekomen.')
      else if (j.status === 'onvolledig') toast.warning(`Nog niet gepland. Ontbreekt: ${j.ontbreekt.join(', ')}.`)
      else toast.info(j.reden ?? 'Niets gepland.')
      await laad(); router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Plannen mislukt.') } finally { setBezig(false) }
  }

  if (facturen === null) return null
  const ok = laatste?.sync_status === 'ok'
  const opm = laatste?.details?.opmerkingen ?? []

  // Facturen gepland (automatisch of door het team): kort zeggen wat er gebeurde.
  if (facturen > 0) {
    if (!ok) return null
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-950 space-y-1">
        <p className="flex items-start gap-2"><CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
          <span><b className="font-semibold">Facturen automatisch gepland uit het contract:</b> {laatste?.details?.samenvatting}. <Link href="/admin/invoices" className="underline">Te factureren</Link></span></p>
        {opm.length > 0 && <ul className="pl-6 list-disc text-xs text-green-900 space-y-0.5">{opm.map((o, i) => <li key={i}>{o}</li>)}</ul>}
      </div>
    )
  }

  // Getekend maar nog geen facturen: dit mag niet blijven liggen.
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-950 space-y-2">
      <div className="flex items-start gap-3 flex-wrap">
        <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-[220px]">
          <b className="font-semibold">Getekend, maar er zijn nog geen facturen gepland.</b>
          {laatste?.sync_status === 'onvolledig' && laatste.details?.ontbreekt?.length
            ? <span> Ontbreekt: {laatste.details.ontbreekt.join(', ')}. Vul dat aan bij de contractgegevens of de looptijd en probeer opnieuw, of plan ze zelf hieronder.</span>
            : laatste?.sync_status === 'fout'
              ? <span> Het automatisch plannen lukte niet{laatste.fout ? ` (${laatste.fout})` : ''}. Probeer opnieuw of plan ze zelf hieronder.</span>
              : <span> De app leest het contract en zet elke factuur bij Te factureren.</span>}
          {opm.length > 0 && <ul className="pl-4 mt-1 list-disc text-xs space-y-0.5">{opm.map((o, i) => <li key={i}>{o}</li>)}</ul>}
        </div>
        <button type="button" onClick={plan} disabled={bezig} className="btn-primary text-sm shrink-0">
          {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : laatste ? <RefreshCw className="h-4 w-4" /> : <Receipt className="h-4 w-4" />}
          {bezig ? 'Contract lezen…' : laatste ? 'Opnieuw proberen' : 'Facturen plannen'}
        </button>
      </div>
    </div>
  )
}
