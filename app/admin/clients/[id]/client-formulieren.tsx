'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ClipboardPen, Send } from 'lucide-react'
import { cn } from '@/lib/utils'
import { INZENDING_STATUS_INFO, type InzendingStatus } from '@/lib/formulieren/model'

type Rij = { id: string; formulier_id: string; formulier_titel: string; naam: string | null; status: InzendingStatus; created_at: string }

/**
 * Klant-hub: de laatste formulierinzendingen van deze klant + een snelkoppeling
 * om een formulier te versturen. Verbergt zichzelf voor wie de module
 * Formulieren niet heeft (de API geeft dan 403).
 */
export function ClientFormulieren({ clientId }: { clientId: string }) {
  const [rijen, setRijen] = useState<Rij[] | null>(null)
  const [openLinks, setOpenLinks] = useState(0)
  const [verborgen, setVerborgen] = useState(false)

  useEffect(() => {
    fetch(`/api/admin/formulieren/inzendingen?klant=${clientId}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) { setVerborgen(true); return }
        const j = await r.json(); setRijen(j.inzendingen ?? []); setOpenLinks(j.open_links ?? 0)
      })
      .catch(() => setVerborgen(true))
  }, [clientId])

  if (verborgen) return null

  return (
    <div className="card-base space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold text-sm text-gray-900 flex items-center gap-1.5"><ClipboardPen className="h-4 w-4 text-gray-400" />Formulieren</h2>
        <Link href={`/admin/formulieren?klant=${clientId}`} className="btn-secondary text-xs px-2.5 py-1"><Send className="h-3.5 w-3.5" />Formulier versturen</Link>
      </div>
      {rijen === null ? (
        <p className="text-xs text-gray-400">Laden…</p>
      ) : rijen.length === 0 ? (
        <p className="text-sm text-gray-400">Nog geen inzendingen{openLinks > 0 ? ` · ${openLinks} open link${openLinks === 1 ? '' : 's'}` : ''}.</p>
      ) : (
        <ul className="space-y-1">
          {rijen.map((r) => (
            <li key={r.id}>
              <Link href={`/admin/formulieren/${r.formulier_id}?tab=inzendingen`} className="flex items-center gap-2 py-1.5 px-2 rounded-lg hover:bg-gray-50">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.formulier_titel}</div>
                  <div className="text-xs text-gray-400 truncate">{new Date(r.created_at).toLocaleDateString('nl-BE', { day: 'numeric', month: 'short', year: 'numeric' })}{r.naam ? ` · ${r.naam}` : ''}</div>
                </div>
                <span className={cn('status-badge shrink-0', INZENDING_STATUS_INFO[r.status]?.kleur)}>{INZENDING_STATUS_INFO[r.status]?.label ?? r.status}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
