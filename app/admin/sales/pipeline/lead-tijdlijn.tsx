'use client'

import { useCallback, useEffect, useState } from 'react'
import { Loader2, MessageSquare, Phone, ArrowRight, Settings2, CalendarDays } from 'lucide-react'
import { stageLabel } from '@/lib/sales/stages'
import { afspraakMoment } from '@/lib/sales/briefing'

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

export type Afspraak = {
  id: string
  starts_at: string
  ends_at: string
  status: string
  outcome: 'won' | 'lost' | null
  titel: string | null
  adres: string | null
  meet_url: string | null
  /** De briefing van de setter, ingetikt bij het boeken. */
  notes: string | null
  /** Wat er met de prospect zelf afgesproken is. */
  client_note: string | null
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
  const [afspraken, setAfspraken] = useState<Afspraak[]>([])
  const [laadFout, setLaadFout] = useState<string | null>(null)

  const laad = useCallback(async () => {
    try {
      const r = await fetch(`/api/admin/sales/leads/${leadId}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error)
      setItems((j.events ?? []) as Gebeurtenis[])
      setAfspraken((j.afspraken ?? []) as Afspraak[])
      setLaadFout(null)
    } catch (e) {
      // Een tijdlijn die niet laadt mag het scherm niet blokkeren — maar
      // "niets genoteerd" tonen terwijl het laden mislukte, is misleidend.
      // Dus: leeg, mét de reden erbij.
      setItems([]); setAfspraken([])
      setLaadFout(e instanceof Error && e.message ? e.message : 'De tijdlijn kon niet geladen worden.')
    }
  }, [leadId])

  useEffect(() => { setItems(null); laad() }, [laad, verversSleutel])

  if (items === null) {
    return <div className="py-3 text-center text-gray-300"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></div>
  }
  if (laadFout) {
    return <p className="text-[11px] text-red-600">Tijdlijn niet geladen: {laadFout} <button type="button" onClick={laad} className="underline">Opnieuw proberen</button></p>
  }
  if (items.length === 0 && afspraken.length === 0) {
    return <p className="text-[11px] text-gray-400">Nog niets genoteerd bij deze lead.</p>
  }

  return (
    <>
    {/* De afspraken met de briefing van de setter. Dit is wat je zoekt als je
        vóór het gesprek wil weten wat er aan de telefoon gezegd is. */}
    {afspraken.length > 0 && (
      <ul className="mb-2 space-y-1.5">
        {afspraken.map((a) => (
          <li key={a.id} className={`rounded-lg border px-2 py-1.5 ${a.status === 'cancelled' ? 'border-gray-200 bg-gray-50 opacity-70' : 'border-[#fff848] bg-[#fffde6]'}`}>
            <p className="text-[11px] font-semibold text-gray-800 flex items-center gap-1">
              <CalendarDays className="h-3 w-3 shrink-0" />
              Afspraak {afspraakMoment(a.starts_at)}
              {a.status === 'cancelled' ? ' · geannuleerd' : a.outcome === 'won' ? ' · gewonnen' : a.outcome === 'lost' ? ' · verloren' : ''}
            </p>
            {a.notes
              ? <p className="text-[12px] text-gray-800 whitespace-pre-wrap break-words mt-0.5">{a.notes}</p>
              : <p className="text-[11px] text-gray-400 mt-0.5">Geen briefing meegegeven bij het boeken.</p>}
            {a.client_note && <p className="text-[11px] text-gray-600 mt-0.5"><b>Afgesproken met de prospect:</b> {a.client_note}</p>}
            {a.adres && <p className="text-[11px] text-gray-500 mt-0.5">Adres: {a.adres}</p>}
          </li>
        ))}
      </ul>
    )}
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
    </>
  )
}
