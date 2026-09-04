'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageSquare, Phone, ArrowRight, Settings2 } from 'lucide-react'
import { stageLabel } from '@/lib/sales/stages'

/**
 * De tijdlijn van een lead: wat er gezegd, gewijzigd en gebeld is.
 *
 * Notities werden al bewaard, maar nergens getoond. Je typte iets, klikte
 * opslaan, en zag het nooit meer terug — waardoor het lijkt alsof het niet
 * opslaat. Dit is dat ontbrekende stuk: hetzelfde lijstje in het detailpaneel
 * van de pipeline én in het belscherm, zodat je vóór je belt weet wat er de
 * vorige keer gezegd is.
 */

export type Gebeurtenis = {
  id: string
  kind: 'call' | 'note' | 'stage' | 'system' | string
  body: string | null
  from_stage: string | null
  to_stage: string | null
  actor_email: string | null
  created_at: string
}

const IKOON: Record<string, typeof Phone> = {
  call: Phone, note: MessageSquare, stage: ArrowRight, system: Settings2,
}

const wanneer = (iso: string) =>
  new Date(iso).toLocaleString('nl-BE', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

/** Wat er in één regel staat. Een fasewissel heeft geen tekst maar wel richting. */
export function regelTekst(e: Gebeurtenis): string {
  if (e.body?.trim()) return e.body.trim()
  if (e.kind === 'stage') {
    return `${e.from_stage ? stageLabel(e.from_stage) : '—'} → ${e.to_stage ? stageLabel(e.to_stage) : '—'}`
  }
  return '—'
}

/**
 * Haalt de tijdlijn op en toont ze. `verversSleutel` verandert zodra er iets
 * bewaard is; dan wordt er opnieuw geladen zonder dat de ouder de lijst zelf
 * hoeft te beheren.
 */
export function LeadTijdlijn({ leadId, verversSleutel = 0, max = 8, compact = false }: {
  leadId: string
  verversSleutel?: number
  max?: number
  compact?: boolean
}) {
  const [items, setItems] = useState<Gebeurtenis[] | null>(null)

  const laad = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/sales/leads/${leadId}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setItems((j.events ?? []) as Gebeurtenis[])
    } catch {
      // Een tijdlijn die niet laadt mag het scherm niet blokkeren: dan blijft
      // het gewoon leeg en kun je verder werken.
      setItems([])
    }
  }, [leadId])

  useEffect(() => { setItems(null); laad() }, [laad, verversSleutel])

  if (items === null) {
    return <div className="py-3 text-center text-gray-300"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
  }
  if (items.length === 0) {
    return <p className="text-[11px] text-gray-400">Nog niets genoteerd bij deze lead.</p>
  }

  return (
    <ul className={compact ? 'space-y-1.5' : 'space-y-2'}>
      {items.slice(0, max).map((e) => {
        const Icon = IKOON[e.kind] ?? Settings2
        return (
          <li key={e.id} className="flex items-start gap-1.5">
            <Icon className={`h-3 w-3 mt-1 shrink-0 ${e.kind === 'note' || e.kind === 'call' ? 'text-gray-500' : 'text-gray-300'}`} />
            <div className="min-w-0">
              <p className={`text-[12px] leading-snug whitespace-pre-wrap break-words ${e.kind === 'system' || e.kind === 'stage' ? 'text-gray-500' : 'text-gray-800'}`}>
                {regelTekst(e)}
              </p>
              <p className="text-[10px] text-gray-400">
                {wanneer(e.created_at)}{e.actor_email ? ` · ${e.actor_email.split('@')[0]}` : ''}
              </p>
            </div>
          </li>
        )
      })}
      {items.length > max && (
        <li className="text-[10px] text-gray-400">+ {items.length - max} eerdere</li>
      )}
    </ul>
  )
}
