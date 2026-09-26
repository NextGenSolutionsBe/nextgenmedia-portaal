'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Pencil, Trash2, Lock, Check } from 'lucide-react'
import { Dialoog, Bevestig, INP } from '@/app/admin/instellingen/ui'
import { GetalInvoer } from '@/components/ui/getal-invoer'
import { formatEuro } from '@/lib/utils'

export type LedgerPost = {
  id: string
  kind: string
  status: string
  amount: number
  description: string | null
  client_id: string | null
  occurred_on: string
  direction: 'we_pay_partner' | 'partner_pays_us'
  settlement_id: string | null
  commission_deal_id: string | null
  assignment_id: string | null
}

/** Zelfde regel als de server (ledger-route): enkel handmatige posten zijn vrij. */
function waaromVast(e: LedgerPost): string | null {
  if (e.kind === 'settlement' || e.settlement_id || e.status === 'settled') {
    return 'Deze post is al afgerekend en hoort bij een afrekening. Draai eerst de afrekening terug.'
  }
  if (e.commission_deal_id || e.kind === 'commission_owed') {
    return 'Deze commissiepost komt uit een doorverwijzing. Pas de verkoop aan of verwijder ze bij ‘Doorverwijzingen’.'
  }
  if (e.assignment_id) {
    return 'Deze post komt uit een afgeronde opdracht. Pas de opdracht aan bij ‘Opdrachten’.'
  }
  return null
}

export function LedgerRowActions({ partnerId, entry, clients }: {
  partnerId: string
  entry: LedgerPost
  clients: { id: string; company_name: string }[]
}) {
  const router = useRouter()
  const [bewerk, setBewerk] = useState(false)
  const [verwijder, setVerwijder] = useState(false)
  const [bezig, setBezig] = useState(false)
  const [form, setForm] = useState({
    amount: Math.abs(entry.amount) as number | null,
    description: entry.description ?? '',
    occurred_on: entry.occurred_on?.slice(0, 10) ?? '',
    client_id: entry.client_id ?? '',
  })

  const vast = waaromVast(entry)
  if (vast) {
    return (
      <button type="button" onClick={() => toast.info(vast, { duration: 8000 })}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-300 hover:bg-gray-100 hover:text-gray-500"
        title={vast} aria-label="Gekoppeld aan bron">
        <Lock className="h-3.5 w-3.5" />
      </button>
    )
  }

  const opslaan = async () => {
    if (!form.amount || form.amount <= 0) { toast.error('Geef een geldig bedrag'); return }
    if (!form.description.trim()) { toast.error('Omschrijving is verplicht'); return }
    setBezig(true)
    try {
      const res = await fetch(`/api/admin/partners/${partnerId}/ledger`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_id: entry.id, amount: form.amount, description: form.description.trim(),
          occurred_on: form.occurred_on, client_id: form.client_id || null,
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Opslaan mislukt')
      toast.success('Post bijgewerkt.')
      setBewerk(false)
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Opslaan mislukt') } finally { setBezig(false) }
  }

  const wis = async () => {
    setBezig(true)
    try {
      const res = await fetch(`/api/admin/partners/${partnerId}/ledger?entry_id=${entry.id}`, { method: 'DELETE' })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error ?? 'Verwijderen mislukt')
      toast.success('Post verwijderd.')
      setVerwijder(false)
      router.refresh()
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Verwijderen mislukt') } finally { setBezig(false) }
  }

  const lbl = 'block text-xs font-medium text-gray-600 mb-1'
  const wePay = entry.direction === 'we_pay_partner'

  return (
    <div className="inline-flex items-center gap-1">
      <button type="button" onClick={() => setBewerk(true)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
        title="Bewerken" aria-label="Bewerken">
        <Pencil className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => setVerwijder(true)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-red-500 hover:bg-red-50"
        title="Verwijderen" aria-label="Verwijderen">
        <Trash2 className="h-3.5 w-3.5" />
      </button>

      {bewerk && (
        <Dialoog titel="Post bewerken" onSluit={() => !bezig && setBewerk(false)}>
          <div className="space-y-3 text-left">
            <p className="text-xs text-gray-500">
              Richting: <b className={wePay ? 'text-green-700' : 'text-red-700'}>{wePay ? 'wij betalen partner' : 'partner betaalt ons'}</b>
            </p>
            <div>
              <label className={lbl}>Omschrijving *</label>
              <input className={INP} value={form.description} maxLength={500}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Bedrag (€) *</label>
                <GetalInvoer className={INP} waarde={form.amount} min={0}
                  onWaarde={(n) => setForm((f) => ({ ...f, amount: n }))} />
              </div>
              <div>
                <label className={lbl}>Datum</label>
                <input type="date" className={INP} value={form.occurred_on}
                  onChange={(e) => setForm((f) => ({ ...f, occurred_on: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className={lbl}>Gekoppelde klant</label>
              <select className={INP} value={form.client_id} onChange={(e) => setForm((f) => ({ ...f, client_id: e.target.value }))}>
                <option value="">Geen specifieke klant</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
            <div className="flex gap-2 justify-end pt-1">
              <button type="button" onClick={() => setBewerk(false)} disabled={bezig} className="btn-secondary">Annuleren</button>
              <button type="button" onClick={opslaan} disabled={bezig} className="btn-primary">
                {bezig ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Opslaan
              </button>
            </div>
          </div>
        </Dialoog>
      )}

      {verwijder && (
        <Bevestig
          titel="Post verwijderen?"
          tekst={<>De post <b>{entry.description ?? 'zonder omschrijving'}</b> ({formatEuro(Math.abs(entry.amount))}) verdwijnt definitief en telt niet meer mee in het saldo.</>}
          bevestigLabel="Verwijderen"
          gevaarlijk
          bezig={bezig}
          onBevestig={wis}
          onAnnuleer={() => setVerwijder(false)}
        />
      )}
    </div>
  )
}
