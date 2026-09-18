'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, X, ArrowRightLeft, Briefcase } from 'lucide-react'

type Client = { id: string; company_name: string }

type Props = {
  partnerId: string
  clients: Client[]
}

type ModalType = 'outbound' | 'inbound' | null

export function PartnerLedger({ partnerId, clients }: Props) {
  const router = useRouter()
  const [modal, setModal] = useState<ModalType>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const today = new Date().toISOString().slice(0, 10)

  // "outbound" = we pay the partner (we subcontract work to them)
  const [outboundForm, setOutboundForm] = useState({ title: '', amount: '', clientId: '', occurredOn: today })
  // "inbound" = the partner pays us (they gave us a paid job)
  const [inboundForm, setInboundForm] = useState({ title: '', amount: '', clientId: '', occurredOn: today })

  const close = () => { setModal(null); setError(null) }

  const post = async (url: string, body: object) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Mislukt')
      close()
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Onbekende fout')
    } finally {
      setLoading(false)
    }
  }

  const submitOutbound = () => {
    if (!outboundForm.title.trim()) { setError('Voer een omschrijving in'); return }
    if (!outboundForm.amount || parseFloat(outboundForm.amount) <= 0) { setError('Voer een geldig bedrag in'); return }
    post(`/api/admin/partners/${partnerId}/ledger`, {
      kind: 'payout_owed',
      direction: 'we_pay_partner',
      amount: parseFloat(outboundForm.amount),       // positive → we owe partner
      client_id: outboundForm.clientId || null,
      description: outboundForm.title,
      occurred_on: outboundForm.occurredOn,
    })
  }

  const submitInbound = () => {
    if (!inboundForm.title.trim()) { setError('Voer een omschrijving in'); return }
    if (!inboundForm.amount || parseFloat(inboundForm.amount) <= 0) { setError('Voer een geldig bedrag in'); return }
    post(`/api/admin/partners/${partnerId}/ledger`, {
      kind: 'service_billed',
      direction: 'partner_pays_us',
      amount: -parseFloat(inboundForm.amount),       // negative → partner owes us
      client_id: inboundForm.clientId || null,
      description: inboundForm.title,
      occurred_on: inboundForm.occurredOn,
    })
  }

  const inp = 'input-base'
  const lbl = 'block text-sm font-medium text-gray-700 mb-1'

  const modalTitle: Record<NonNullable<ModalType>, string> = {
    outbound: 'Wij betalen partner',
    inbound: 'Partner betaalt ons',
  }

  const handleAction = () => {
    if (modal === 'outbound') return submitOutbound()
    if (modal === 'inbound') return submitInbound()
  }

  const form = modal === 'outbound' ? outboundForm : modal === 'inbound' ? inboundForm : null
  const setForm = modal === 'outbound' ? setOutboundForm : setInboundForm

  return (
    <>
      <div className="card-base">
        <h2 className="font-semibold mb-1">Onderaanneming (vast bedrag)</h2>
        <p className="text-xs text-gray-500 mb-4">
          Voor onderaanneming en losse posten — altijd een vast bedrag, nooit commissie. Commissie op aangeleverde klanten
          beheer je via de doorverwijzingen hierboven. Betalingen registreer je hieronder.
        </p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => { setError(null); setModal('outbound') }} className="btn-secondary flex items-center gap-1.5 text-sm">
            <Briefcase className="h-4 w-4" />
            Wij geven partner opdracht
          </button>
          <button onClick={() => { setError(null); setModal('inbound') }} className="btn-secondary flex items-center gap-1.5 text-sm">
            <ArrowRightLeft className="h-4 w-4" />
            Partner geeft ons opdracht
          </button>
        </div>
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4 max-h-[90dvh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-lg">{modalTitle[modal]}</h3>
              <button onClick={close} className="p-1 rounded-lg hover:bg-gray-100 transition-colors">
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Outbound / Inbound share the same fields */}
            {(modal === 'outbound' || modal === 'inbound') && form && (
              <div className="space-y-3">
                <p className="text-sm text-gray-500">
                  {modal === 'outbound'
                    ? 'Wij huren de partner in voor een opdracht. Dit bedrag moeten WIJ aan de partner betalen.'
                    : 'De partner heeft ons een opdracht gegeven (onderaanneming). Dit bedrag moet de PARTNER aan ONS betalen.'}
                </p>
                <div>
                  <label className={lbl}>Omschrijving *</label>
                  <input
                    className={inp}
                    placeholder={modal === 'outbound' ? 'Bv. Fotoshoot december' : 'Bv. Social media strategie'}
                    value={form.title}
                    onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={lbl}>Bedrag (€) *</label>
                  <input
                    type="number" min="0" step="0.01" className={inp} placeholder="500"
                    value={form.amount}
                    onChange={(e) => setForm((p) => ({ ...p, amount: e.target.value }))}
                  />
                </div>
                <div>
                  <label className={lbl}>Gekoppelde klant (optioneel)</label>
                  <select className={inp} value={form.clientId} onChange={(e) => setForm((p) => ({ ...p, clientId: e.target.value }))}>
                    <option value="">Geen specifieke klant</option>
                    {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={lbl}>Datum</label>
                  <input type="date" className={inp} value={form.occurredOn} onChange={(e) => setForm((p) => ({ ...p, occurredOn: e.target.value }))} />
                </div>
              </div>
            )}

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-3 py-2">{error}</div>
            )}

            <div className="flex gap-2 pt-1">
              <button onClick={handleAction} disabled={loading} className="btn-primary flex-1 justify-center">
                {loading && <Loader2 className="h-4 w-4 animate-spin" />}
                Toevoegen
              </button>
              <button onClick={close} disabled={loading} className="btn-secondary">Annuleren</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
