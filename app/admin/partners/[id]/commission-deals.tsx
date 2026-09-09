'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Loader2, HandCoins, Pencil, Trash2, Receipt, ArrowRight, ArrowLeft } from 'lucide-react'
import { formatEuro, formatDate, SERVICE_LABELS, commissionYearForDate, commissionPctForYear, commissionForSale, referralPartnerPaysUs } from '@/lib/utils'

type Client = { id: string; company_name: string; customer_since: string | null }

export type Referral = {
  id: string
  client_id: string | null
  label: string | null
  service_slug: string | null
  direction?: string | null   // 'we_pay_partner' (scenario 1) | 'partner_pays_us' (scenario 2)
  start_date: string          // first-referral date
  pct_year_1: number
  pct_year_2: number
  pct_year_3: number
  status: string
  notes: string | null
  created_at: string
}

export type Sale = {
  id: string
  deal_id: string
  service_slug: string | null
  description: string | null
  sale_amount: number
  sale_date: string
  commission_year: number
  commission_pct: number
  commission_amount: number
  ledger_id: string | null
}

const SERVICES = [
  { slug: '', label: '— Geen dienst —' },
  { slug: 'social-media', label: 'Social Media' },
  { slug: 'webdesign', label: 'Website' },
  { slug: 'foto-video', label: 'Foto & Videografie' },
  { slug: 'grafisch-ontwerp', label: 'Grafisch Ontwerp' },
  { slug: 'marketing-consultancy', label: 'Marketing Consultancy' },
  { slug: 'ads', label: 'Google Advertising' },
]

export function CommissionDeals({
  partnerId,
  clients,
  deals,
  salesByDeal,
}: {
  partnerId: string
  clients: Client[]
  deals: Referral[]
  salesByDeal: Record<string, Sale[]>
}) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<Referral | null>(null)
  const [addSaleFor, setAddSaleFor] = useState<Referral | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const clientName = (d: Referral) =>
    d.client_id ? (clients.find((c) => c.id === d.client_id)?.company_name ?? d.label ?? 'Klant') : (d.label ?? 'Lead')

  const removeReferral = async (d: Referral) => {
    if (!confirm(`Doorverwijzing voor "${clientName(d)}" verwijderen? Alle bijbehorende commissies verdwijnen ook.`)) return
    setBusy(d.id)
    try {
      const res = await fetch(`/api/admin/partners/${partnerId}/commission-deals?deal_id=${d.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fout')
    } finally {
      setBusy(null)
    }
  }

  const removeSale = async (s: Sale) => {
    if (!confirm('Deze verkoop + bijbehorende commissie verwijderen?')) return
    setBusy(s.id)
    try {
      const res = await fetch(`/api/admin/partners/${partnerId}/commission-deals?sale_id=${s.id}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      router.refresh()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Fout')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="card-base">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <HandCoins className="h-4 w-4 text-[#c5b800]" />
            Doorverwijzingen (commissie)
          </h2>
          <p className="text-xs text-gray-500 mt-0.5">Elke verkoop levert commissie op (10/8/5% per jaar). Richting bepaalt wie betaalt: partner verwees klant naar ons (wij betalen) of wij verwezen naar partner (partner betaalt ons). Onderaanneming met vast bedrag staat hieronder en geeft nooit commissie.</p>
        </div>
        <button onClick={() => setShowCreate(true)} className="btn-secondary text-xs">
          <Plus className="h-3.5 w-3.5" />
          Nieuwe doorverwijzing
        </button>
      </div>

      {deals.length === 0 ? (
        <div className="text-center py-8 text-gray-400">
          <HandCoins className="h-7 w-7 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Nog geen doorverwijzingen</p>
        </div>
      ) : (
        <div className="space-y-3">
          {deals.map((deal) => {
            const currentYear = commissionYearForDate(deal.start_date)
            const currentPct = commissionPctForYear(deal, currentYear)
            const sales = salesByDeal[deal.id] ?? []
            const totalCommission = sales.reduce((s, x) => s + Number(x.commission_amount), 0)
            const partnerPaysUs = referralPartnerPaysUs(deal.direction)
            return (
              <div key={deal.id} className="border border-gray-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div className="min-w-0">
                    <div className="font-medium text-sm flex items-center gap-2 flex-wrap">
                      {clientName(deal)}
                      <span className={`status-badge text-xs ${deal.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {deal.status === 'active' ? 'Actief' : 'Beëindigd'}
                      </span>
                      <span className={`status-badge text-xs inline-flex items-center gap-1 ${partnerPaysUs ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'}`}>
                        {partnerPaysUs
                          ? <><ArrowLeft className="h-3 w-3" /> Partner betaalt ons</>
                          : <><ArrowRight className="h-3 w-3" /> Wij betalen partner</>}
                      </span>
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Doorverwezen op {formatDate(deal.start_date)} ·{' '}
                      <span className="font-medium text-gray-600">Nu jaar {currentYear} ({currentPct}%)</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => setEditing(deal)} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400" title="Bewerken">
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => removeReferral(deal)} disabled={busy === deal.id} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-red-400" title="Verwijderen">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Yearly rate reference */}
                <div className="grid grid-cols-3 gap-2 mb-3">
                  {[1, 2, 3].map((y) => (
                    <div key={y} className={`rounded-lg border p-2 text-center text-xs ${currentYear === y ? 'border-[#fff848] bg-[#fff848]/10' : 'border-gray-200'}`}>
                      <div className="text-[10px] text-gray-400 uppercase">Jaar {y}</div>
                      <div className="font-bold">{commissionPctForYear(deal, y)}%</div>
                    </div>
                  ))}
                </div>

                {/* Sales list */}
                {sales.length > 0 && (
                  <div className="space-y-1.5 mb-3">
                    {sales.map((s) => (
                      <div key={s.id} className="flex items-center justify-between gap-2 text-xs bg-gray-50 rounded-lg px-3 py-2">
                        <div className="min-w-0">
                          <div className="font-medium text-gray-700 truncate">
                            {s.description || (s.service_slug ? (SERVICE_LABELS[s.service_slug] ?? s.service_slug) : 'Verkoop')}
                          </div>
                          <div className="text-gray-400">
                            {formatDate(s.sale_date)} · {formatEuro(s.sale_amount)} × {s.commission_pct}% (jaar {s.commission_year})
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`font-semibold ${partnerPaysUs ? 'text-red-600' : 'text-green-600'}`}>
                            {partnerPaysUs ? '−' : '+'}{formatEuro(s.commission_amount)}
                          </span>
                          <button onClick={() => removeSale(s)} disabled={busy === s.id} className="text-red-400 hover:text-red-600" title="Verkoop verwijderen">
                            <Trash2 className="h-3 w-3" />
                          </button>
                        </div>
                      </div>
                    ))}
                    <div className="flex justify-between text-xs font-semibold pt-1 px-1">
                      <span className="text-gray-500">{partnerPaysUs ? 'Totaal — partner betaalt ons' : 'Totaal commissie — wij betalen partner'}</span>
                      <span className={partnerPaysUs ? 'text-red-700' : 'text-green-700'}>{formatEuro(totalCommission)}</span>
                    </div>
                  </div>
                )}

                <button onClick={() => setAddSaleFor(deal)} className="btn-secondary text-xs w-full justify-center">
                  <Receipt className="h-3.5 w-3.5" />
                  Verkoop toevoegen
                </button>
                {deal.notes && <p className="text-xs text-gray-400 mt-2">{deal.notes}</p>}
              </div>
            )
          })}
        </div>
      )}

      {(showCreate || editing) && (
        <ReferralDialog
          partnerId={partnerId}
          clients={clients}
          referral={editing}
          onClose={() => { setShowCreate(false); setEditing(null) }}
          onSaved={() => { setShowCreate(false); setEditing(null); router.refresh() }}
        />
      )}

      {addSaleFor && (
        <AddSaleDialog
          partnerId={partnerId}
          referral={addSaleFor}
          onClose={() => setAddSaleFor(null)}
          onSaved={() => { setAddSaleFor(null); router.refresh() }}
        />
      )}
    </div>
  )
}

function ReferralDialog({
  partnerId, clients, referral, onClose, onSaved,
}: {
  partnerId: string
  clients: Client[]
  referral: Referral | null
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = !!referral
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    client_id: referral?.client_id ?? '',
    label: referral?.label ?? '',
    direction: referral?.direction === 'partner_pays_us' ? 'partner_pays_us' : 'we_pay_partner',
    start_date: referral?.start_date ?? new Date().toISOString().slice(0, 10),
    pct_year_1: referral ? String(referral.pct_year_1) : '10',
    pct_year_2: referral ? String(referral.pct_year_2) : '8',
    pct_year_3: referral ? String(referral.pct_year_3) : '5',
    notes: referral?.notes ?? '',
  })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.client_id && !form.label.trim()) { setError('Kies een klant of geef een naam op'); return }
    setLoading(true)
    try {
      const payload = {
        client_id: form.client_id || null,
        label: form.label || null,
        direction: form.direction,
        start_date: form.start_date,
        pct_year_1: parseFloat(form.pct_year_1) || 0,
        pct_year_2: parseFloat(form.pct_year_2) || 0,
        pct_year_3: parseFloat(form.pct_year_3) || 0,
        notes: form.notes || null,
      }
      const res = await fetch(`/api/admin/partners/${partnerId}/commission-deals`, {
        method: isEdit ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(isEdit ? { deal_id: referral!.id, ...payload } : payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout')
    } finally {
      setLoading(false)
    }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <h3 className="font-semibold">{isEdit ? 'Doorverwijzing bewerken' : 'Nieuwe doorverwijzing'}</h3>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className={lbl}>Richting van de commissie</label>
            <div className="grid grid-cols-1 gap-2">
              {([
                ['we_pay_partner', 'Partner verwees klant naar ons', 'Wij betalen de partner commissie op elke verkoop.'],
                ['partner_pays_us', 'Wij verwezen klant naar partner', 'De partner betaalt ons commissie op elke verkoop.'],
              ] as const).map(([val, title, desc]) => (
                <button
                  type="button"
                  key={val}
                  onClick={() => setForm((p) => ({ ...p, direction: val }))}
                  className={`text-left rounded-lg border p-3 transition-colors ${form.direction === val ? 'border-[#fff848] bg-[#fff848]/10 ring-1 ring-[#fff848]' : 'border-gray-200 hover:border-gray-300'}`}
                >
                  <div className="text-sm font-medium flex items-center gap-1.5">
                    {val === 'partner_pays_us' ? <ArrowLeft className="h-3.5 w-3.5" /> : <ArrowRight className="h-3.5 w-3.5" />}
                    {title}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5">{desc}</div>
                </button>
              ))}
            </div>
          </div>
          <div>
            <label className={lbl}>Klant (bestaand)</label>
            <select className={inp} value={form.client_id} onChange={(e) => setForm((p) => ({ ...p, client_id: e.target.value }))}>
              <option value="">— Of geef hieronder een naam op —</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          {!form.client_id && (
            <div>
              <label className={lbl}>Naam lead / klant</label>
              <input className={inp} value={form.label} onChange={(e) => setForm((p) => ({ ...p, label: e.target.value }))} placeholder="Bv. Bakkerij Janssens" />
            </div>
          )}
          <div>
            <label className={lbl}>Datum eerste doorverwijzing</label>
            <input type="date" className={inp} value={form.start_date} onChange={(e) => setForm((p) => ({ ...p, start_date: e.target.value }))} />
            <p className="text-[11px] text-gray-400 mt-1">Bepaalt het commissiejaar van elke latere verkoop.</p>
          </div>
          <div>
            <label className={lbl}>Commissie per jaar (%)</label>
            <div className="grid grid-cols-3 gap-2">
              {([['pct_year_1', 'Jaar 1'], ['pct_year_2', 'Jaar 2'], ['pct_year_3', 'Jaar 3']] as const).map(([key, label]) => (
                <div key={key}>
                  <span className="block text-[10px] text-gray-400 mb-0.5">{label}</span>
                  <input type="number" min="0" max="100" step="0.5" className={inp} value={form[key]} onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))} />
                </div>
              ))}
            </div>
          </div>
          <div>
            <label className={lbl}>Notities</label>
            <textarea rows={2} className={inp} value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
          </div>
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <HandCoins className="h-4 w-4" />}
              {isEdit ? 'Opslaan' : 'Doorverwijzing aanmaken'}
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Annuleer</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function AddSaleDialog({
  partnerId, referral, onClose, onSaved,
}: {
  partnerId: string
  referral: Referral
  onClose: () => void
  onSaved: () => void
}) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [form, setForm] = useState({
    description: '',
    service_slug: referral.service_slug ?? '',
    sale_amount: '',
    sale_date: new Date().toISOString().slice(0, 10),
  })

  // Live preview of the commission for the entered amount/date
  const preview = form.sale_amount && parseFloat(form.sale_amount) > 0
    ? commissionForSale(
        { referred_at: referral.start_date, pct_year_1: referral.pct_year_1, pct_year_2: referral.pct_year_2, pct_year_3: referral.pct_year_3 },
        parseFloat(form.sale_amount),
        form.sale_date,
      )
    : null

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.sale_amount || parseFloat(form.sale_amount) <= 0) { setError('Verkoopbedrag is verplicht'); return }
    setLoading(true)
    try {
      const res = await fetch(`/api/admin/partners/${partnerId}/commission-deals`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deal_id: referral.id,
          action: 'add_sale',
          sale_amount: parseFloat(form.sale_amount),
          sale_date: form.sale_date,
          service_slug: form.service_slug || null,
          description: form.description || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fout')
    } finally {
      setLoading(false)
    }
  }

  const inp = 'w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#fff848]/50 focus:border-[#fff848]'
  const lbl = 'block text-xs font-medium text-gray-600 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90dvh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h3 className="font-semibold">Verkoop toevoegen</h3>
            <p className="text-xs text-gray-500 mt-0.5">{referral.label ?? 'doorverwezen klant'}</p>
          </div>
          <button onClick={onClose} className="h-7 w-7 flex items-center justify-center rounded-lg hover:bg-gray-100">
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          <div>
            <label className={lbl}>Omschrijving</label>
            <input className={inp} value={form.description} onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))} placeholder="Bv. Website project" />
          </div>
          <div>
            <label className={lbl}>Dienst</label>
            <select className={inp} value={form.service_slug} onChange={(e) => setForm((p) => ({ ...p, service_slug: e.target.value }))}>
              {SERVICES.map((s) => <option key={s.slug || 'none'} value={s.slug}>{s.label}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Verkoopbedrag (€)</label>
              <input type="number" min="0" step="0.01" className={inp} value={form.sale_amount} onChange={(e) => setForm((p) => ({ ...p, sale_amount: e.target.value }))} placeholder="5000" />
            </div>
            <div>
              <label className={lbl}>Verkoopdatum</label>
              <input type="date" className={inp} value={form.sale_date} onChange={(e) => setForm((p) => ({ ...p, sale_date: e.target.value }))} />
            </div>
          </div>

          {preview && (
            (() => {
              const partnerPaysUs = referralPartnerPaysUs(referral.direction)
              return (
                <div className={`border rounded-lg px-3 py-2.5 text-sm ${partnerPaysUs ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200'}`}>
                  <span className="text-gray-600">Commissie (jaar {preview.year}, {preview.pct}%):</span>{' '}
                  <span className={`font-bold ${partnerPaysUs ? 'text-red-700' : 'text-green-700'}`}>{formatEuro(preview.amount)}</span>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {partnerPaysUs ? 'Partner betaalt dit bedrag aan ons.' : 'Wij betalen dit bedrag aan de partner.'}
                  </div>
                </div>
              )
            })()
          )}

          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
          <div className="flex gap-2 pt-1">
            <button type="submit" disabled={loading} className="btn-primary flex-1 justify-center">
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Receipt className="h-4 w-4" />}
              Verkoop + commissie toevoegen
            </button>
            <button type="button" onClick={onClose} className="btn-secondary">Annuleer</button>
          </div>
        </form>
      </div>
    </div>
  )
}
