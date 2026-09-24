'use client'

import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ShieldCheck, ShieldAlert, ShieldQuestion, Loader2, RefreshCw } from 'lucide-react'
import { STATUS_LABEL, type Oordeel } from '@/lib/sales/lead-kwaliteit'

type Controle = {
  status: Oordeel['status'] | 'niet_gecontroleerd'; reden: string | null
  telefoon_norm: string | null; website_norm: string | null; gecontroleerd_op: string
}

const GOED = new Set(['geverifieerd', 'vertrouwd'])

/**
 * Klopt deze lead? Toont het laatste controleresultaat (telefoon geldig, nummer
 * op de eigen website) en laat het opnieuw controleren. Wijzigt de lead niet.
 */
export function LeadControle({ leadId }: { leadId: string }) {
  const [c, setC] = useState<Controle | null | undefined>(undefined)
  const [bezig, setBezig] = useState(false)

  useEffect(() => {
    let weg = false
    setC(undefined)
    fetch(`/api/admin/sales/leads/${leadId}/controle`, { cache: 'no-store' })
      .then((r) => r.json()).then((j) => { if (!weg) setC(j.controle ?? null) }).catch(() => { if (!weg) setC(null) })
    return () => { weg = true }
  }, [leadId])

  const controleer = async () => {
    setBezig(true)
    try {
      const r = await fetch(`/api/admin/sales/leads/${leadId}/controle`, { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'Controle mislukt')
      setC(j.controle)
      toast[GOED.has(j.controle.status) ? 'success' : 'warning'](STATUS_LABEL[j.controle.status as Oordeel['status']] ?? 'Gecontroleerd')
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Controle mislukt') } finally { setBezig(false) }
  }

  if (c === undefined) return null
  const goed = c && GOED.has(c.status)
  const open = !c || c.status === 'niet_gecontroleerd'
  const Icon = goed ? ShieldCheck : open ? ShieldQuestion : ShieldAlert
  const kleur = goed ? 'text-emerald-700 bg-emerald-50 border-emerald-200' : open ? 'text-gray-600 bg-gray-50 border-gray-200' : 'text-amber-800 bg-amber-50 border-amber-200'
  const titel = !c ? 'Nog niet gecontroleerd' : c.status === 'niet_gecontroleerd' ? 'Nog niet op de website nagekeken' : STATUS_LABEL[c.status]

  return (
    <div className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${kleur}`}>
      <Icon className="h-4 w-4 shrink-0 mt-px" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">{titel}</div>
        {c?.reden && c.status !== 'niet_gecontroleerd' && <div className="opacity-80">{c.reden}</div>}
        {c && <div className="opacity-60">{new Date(c.gecontroleerd_op).toLocaleDateString('nl-BE')}</div>}
      </div>
      <button type="button" onClick={controleer} disabled={bezig} title="Telefoon en website nu controleren"
        className="shrink-0 inline-flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-white/70 disabled:opacity-50">
        {bezig ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}Controleren
      </button>
    </div>
  )
}
