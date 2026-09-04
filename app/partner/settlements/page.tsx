export const dynamic = 'force-dynamic'

import { createClient, createAdminSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatEuro, formatDate, normalizeDirection } from '@/lib/utils'
import { computePartnerFinance, type LedgerRow, type PaymentRow } from '@/lib/partner-finance'
import { ArrowLeftRight, TrendingUp, TrendingDown, Wallet } from 'lucide-react'
import { PartnerPaymentForm } from './payment-form'

const KIND_LABEL: Record<string, string> = {
  payout_owed: 'Onderaanneming', commission_owed: 'Commissie', service_billed: 'Onderaanneming',
  manual_credit: 'Tegoed', manual_debit: 'Debet', settlement: 'Afrekening',
}
const PAY_STATUS: Record<string, { label: string; cls: string }> = {
  pending: { label: 'In afwachting', cls: 'bg-amber-100 text-amber-700' },
  approved: { label: 'Goedgekeurd', cls: 'bg-green-100 text-green-700' },
  cancelled: { label: 'Geannuleerd', cls: 'bg-gray-100 text-gray-600' },
}

export default async function PartnerSettlementsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: partner } = await supabase.from('freelancers').select('id, name, hourly_rate').eq('user_id', user.id).maybeSingle()
  if (!partner) redirect('/login')

  const admin = createAdminSupabaseClient()
  const [{ data: ledgerRows }, { data: paymentRows }] = await Promise.all([
    admin.from('partner_ledger_entries').select('*').eq('freelancer_id', partner.id).order('occurred_on', { ascending: false }),
    admin.from('partner_payments').select('*').eq('freelancer_id', partner.id).order('created_at', { ascending: false }),
  ])

  type Ledger = { id: string; kind: string; status: string; amount: number; direction?: string | null; description: string | null; occurred_on: string }
  type PaymentT = { id: string; direction: string; amount: number; status: string; paid_on: string; note: string | null; created_by_role: string | null }
  const ledger = (ledgerRows ?? []) as Ledger[]
  const payments = (paymentRows ?? []) as PaymentT[]

  const live = ledger.filter((l) => l.status !== 'cancelled')
  // KPI's via DE centrale bron (zelfde cijfers als admin + partnerdashboard).
  const fin = computePartnerFinance({ ledger: ledger as LedgerRow[], payments: payments as PaymentRow[], deals: [], sales: [] })
  const toReceive = fin.openToPartner   // u ontvangt nog
  const toPay = fin.openByPartner       // u betaalt nog
  const net = toReceive - toPay         // standpunt partner: + = u ontvangt

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Settlements</h1>
          <p className="text-sm text-gray-500 mt-0.5">Wat wij u betalen en wat u ons betaalt</p>
        </div>
        <PartnerPaymentForm />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1"><TrendingUp className="h-4 w-4 text-green-500" /><span className="text-xs text-gray-500 font-medium">U ontvangt nog</span></div>
          <div className="text-2xl font-bold text-green-600">{formatEuro(Math.max(0, toReceive))}</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1"><TrendingDown className="h-4 w-4 text-red-500" /><span className="text-xs text-gray-500 font-medium">U betaalt nog</span></div>
          <div className="text-2xl font-bold text-red-600">{formatEuro(Math.max(0, toPay))}</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1"><Wallet className="h-4 w-4 text-[#c5b800]" /><span className="text-xs text-gray-500 font-medium">Netto saldo</span></div>
          <div className={`text-2xl font-bold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>{net >= 0 ? '+' : '−'}{formatEuro(Math.abs(net))}</div>
          <div className="text-xs text-gray-400 mt-1">{net >= 0 ? 'u ontvangt' : 'u betaalt ons'}</div>
        </div>
      </div>

      {/* Open posten (verplichtingen) */}
      <div className="card-base">
        <h2 className="font-semibold text-gray-900 mb-4">Openstaande posten</h2>
        {live.length === 0 ? (
          <div className="text-center py-10 text-gray-400"><ArrowLeftRight className="h-8 w-8 mx-auto mb-3 opacity-30" /><p className="text-sm">Geen openstaande posten</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead><tr className="border-b border-gray-100">
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Datum</th>
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Richting</th>
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Type</th>
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Omschrijving</th>
                <th className="text-right py-2 text-xs text-gray-500 font-medium">Bedrag</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {live.map((l) => {
                  const wePay = normalizeDirection(l.direction, l.amount) === 'we_pay_partner'
                  return (
                    <tr key={l.id} className="hover:bg-gray-50/50">
                      <td className="py-2.5 text-gray-500 text-xs">{formatDate(l.occurred_on)}</td>
                      <td className="py-2.5"><span className={`status-badge text-xs ${wePay ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{wePay ? 'Wij betalen u' : 'U betaalt ons'}</span></td>
                      <td className="py-2.5 text-xs text-gray-600">{KIND_LABEL[l.kind] ?? l.kind}</td>
                      <td className="py-2.5 text-gray-700 max-w-[220px] truncate">{l.description ?? '—'}</td>
                      <td className={`py-2.5 text-right font-semibold ${wePay ? 'text-green-600' : 'text-red-600'}`}>{wePay ? '+' : '−'}{formatEuro(Math.abs(l.amount))}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Betalingen */}
      <div className="card-base">
        <h2 className="font-semibold text-gray-900 mb-4">Geregistreerde betalingen</h2>
        {payments.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">Nog geen betalingen geregistreerd.</p>
        ) : (
          <div className="space-y-2">
            {payments.map((p) => {
              const wePay = p.direction === 'we_pay_partner'
              const st = PAY_STATUS[p.status] ?? { label: p.status, cls: 'bg-gray-100 text-gray-600' }
              return (
                <div key={p.id} className="flex items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2.5 flex-wrap">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{wePay ? 'NextGenMedia betaalde u' : 'U betaalde NextGenMedia'} · {formatEuro(Math.abs(p.amount))}</div>
                    <div className="text-xs text-gray-400">{formatDate(p.paid_on)}{p.note ? ` · ${p.note}` : ''}{p.created_by_role === 'partner' ? ' · door u' : ' · door NextGenMedia'}</div>
                  </div>
                  <span className={`status-badge text-xs ${st.cls}`}>{st.label}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {partner.hourly_rate != null && (
        <div className="card-base text-sm"><span className="text-gray-500">Uw uurtarief:</span><span className="font-semibold ml-2">{formatEuro(partner.hourly_rate)}/u</span></div>
      )}
    </div>
  )
}
