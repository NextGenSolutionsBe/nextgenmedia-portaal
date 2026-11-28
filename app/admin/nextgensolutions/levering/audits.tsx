'use client'

import { useCallback, useEffect, useState } from 'react'
import { FileText, Loader2 } from 'lucide-react'
import { faseLabel } from '@/lib/ngs/model'
import { RapportVenster } from '../rapport'
import { dagKort } from '../ui'

type Audit = { id: string; bedrijf: string; fase: string; auditdag_op: string | null; presentatie_op: string | null; rapport_afgerond_op: string | null; workflows: number }

/**
 * De audits die lopen (nieuwe werking fase 3): wie het rapport schrijft, vindt
 * ze hier, ook zonder de pipeline te mogen zien. Geen dealwaarden.
 */
export function AuditsLijst() {
  const [lijst, setLijst] = useState<Audit[] | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const laad = useCallback(() => {
    fetch('/api/admin/nextgensolutions/levering/rapport?audits=1', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : { audits: [] })).then((j) => setLijst(j.audits ?? [])).catch(() => setLijst([]))
  }, [])
  useEffect(() => { laad() }, [laad])
  if (!lijst) return <div className="card-base py-8 flex justify-center"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
  if (!lijst.length) return <div className="card-base text-sm text-gray-500 text-center py-10">Er loopt geen audit.</div>
  return (
    <div className="card-base !p-0 divide-y divide-gray-100">
      {lijst.map((a) => (
        <div key={a.id} className="px-4 py-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold truncate">{a.bedrijf}</div>
            <div className="text-[11px] text-gray-500">{faseLabel(a.fase)} · auditdag {a.auditdag_op ? dagKort(a.auditdag_op) : '—'}{a.presentatie_op ? ` · presentatie ${dagKort(a.presentatie_op)}` : ''} · {a.workflows} {a.workflows === 1 ? 'workflow' : 'workflows'}</div>
          </div>
          <span className={`text-[11px] rounded-full border px-2 py-0.5 ${a.rapport_afgerond_op ? 'border-green-200 bg-green-50 text-green-800' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>{a.rapport_afgerond_op ? 'Rapport af' : 'Rapport open'}</span>
          <button type="button" onClick={() => setOpen(a.id)} className="btn-secondary !py-1 text-xs"><FileText className="h-3.5 w-3.5" />Rapport</button>
        </div>
      ))}
      {open && <RapportVenster dealId={open} onSluit={() => { setOpen(null); laad() }} />}
    </div>
  )
}
