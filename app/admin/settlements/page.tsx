export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { formatEuro, normalizeDirection } from '@/lib/utils'
import { ArrowLeftRight, TrendingUp, TrendingDown, Wallet, ChevronRight, Clock } from 'lucide-react'
import Link from 'next/link'

type LedgerRow = { freelancer_id: string; status: string; amount: number; direction?: string | null }
type PaymentRow = { freelancer_id: string; status: string; amount: number; direction: string }
type PartnerRow = { id: string; name: string | null }

async function getData() {
  try {
    const admin = createAdminSupabaseClient()
    const [{ data: partnerRows }, { data: ledgerRows }, { data: paymentRows }] = await Promise.all([
      admin.from('freelancers').select('id, name').order('name'),
      admin.from('partner_ledger_entries').select('freelancer_id, status, amount, direction'),
      admin.from('partner_payments').select('freelancer_id, status, amount, direction'),
    ])
    return {
      partners: (partnerRows ?? []) as PartnerRow[],
      ledger: (ledgerRows ?? []) as LedgerRow[],
      payments: (paymentRows ?? []) as PaymentRow[],
    }
  } catch {
    return { partners: [] as PartnerRow[], ledger: [] as LedgerRow[], payments: [] as PaymentRow[] }
  }
}

export default async function SettlementsPage() {
  const { partners, ledger, payments } = await getData()
  const partnerName = new Map(partners.map((p) => [p.id, p.name ?? 'Partner']))

  type Agg = { partnerId: string; openToPartner: number; openByPartner: number }
  const byPartner = new Map<string, Agg>()
  const ensure = (pid: string): Agg => {
    let a = byPartner.get(pid)
    if (!a) { a = { partnerId: pid, openToPartner: 0, openByPartner: 0 }; byPartner.set(pid, a) }
    return a
  }

  // Verplichtingen (niet-geannuleerd)
  for (const l of ledger) {
    if (l.status === 'cancelled') continue
    const a = ensure(l.freelancer_id)
    if (normalizeDirection(l.direction, l.amount) === 'we_pay_partner') a.openToPartner += Math.abs(Number(l.amount))
    else a.openByPartner += Math.abs(Number(l.amount))
  }
  // Goedgekeurde betalingen vereffenen
  let pendingApprovals = 0
  for (const p of payments) {
    if (p.status === 'pending') { pendingApprovals++; continue }
    if (p.status !== 'approved') continue
    const a = ensure(p.freelancer_id)
    if (p.direction === 'we_pay_partner') a.openToPartner -= Math.abs(Number(p.amount))
    else a.openByPartner -= Math.abs(Number(p.amount))
  }

  const rows = [...byPartner.values()]
    .map((a) => ({ ...a, net: a.openByPartner - a.openToPartner }))
    .filter((a) => Math.abs(a.openToPartner) > 0.005 || Math.abs(a.openByPartner) > 0.005)
    .sort((x, y) => Math.abs(y.net) - Math.abs(x.net))

  const totalWePay = rows.reduce((s, a) => s + Math.max(0, a.openToPartner), 0)
  const totalPartnerPays = rows.reduce((s, a) => s + Math.max(0, a.openByPartner), 0)
  const openTotal = totalWePay + totalPartnerPays

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Settlements</h1>
        <p className="text-sm text-gray-500 mt-0.5">Openstaande balansen tussen NextGenMedia en partners — commissie (beide richtingen) en onderaanneming, na aftrek van geregistreerde betalingen</p>
      </div>

      {/* KPI's */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center justify-between mb-3"><span className="text-xs text-gray-500 uppercase tracking-wide">Wij moeten betalen</span><TrendingUp className="h-4 w-4 text-green-500" /></div>
          <div className="text-2xl font-bold text-green-600">{formatEuro(totalWePay)}</div>
          <div className="text-xs text-gray-400 mt-1">aan partners</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-3"><span className="text-xs text-gray-500 uppercase tracking-wide">Partners moeten ons</span><TrendingDown className="h-4 w-4 text-red-500" /></div>
          <div className="text-2xl font-bold text-red-600">{formatEuro(totalPartnerPays)}</div>
          <div className="text-xs text-gray-400 mt-1">te ontvangen</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-3"><span className="text-xs text-gray-500 uppercase tracking-wide">Open saldo totaal</span><Wallet className="h-4 w-4 text-[#c5b800]" /></div>
          <div className="text-2xl font-bold">{formatEuro(openTotal)}</div>
          <div className="text-xs text-gray-400 mt-1">nog te vereffenen</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center justify-between mb-3"><span className="text-xs text-gray-500 uppercase tracking-wide">Open settlements</span><ArrowLeftRight className="h-4 w-4 text-gray-400" /></div>
          <div className="text-2xl font-bold">{rows.length}</div>
          <div className="text-xs text-gray-400 mt-1">{pendingApprovals > 0 ? <span className="text-amber-600 inline-flex items-center gap-1"><Clock className="h-3 w-3" />{pendingApprovals} betaling(en) te keuren</span> : 'partners met saldo'}</div>
        </div>
      </div>

      {/* Per partner */}
      <div className="space-y-4">
        <h2 className="font-semibold text-gray-900">Openstaand per partner</h2>
        {rows.length === 0 ? (
          <div className="card-base text-center py-10 text-gray-400">
            <ArrowLeftRight className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Geen openstaande posten</p>
          </div>
        ) : (
          <div className="space-y-3">
            {rows.map((a) => (
              <Link key={a.partnerId} href={`/admin/partners/${a.partnerId}`} className="card-base flex items-center justify-between gap-4 hover:border-gray-300 transition-colors">
                <div className="min-w-0">
                  <div className="font-semibold truncate">{partnerName.get(a.partnerId) ?? 'Partner'}</div>
                  <div className="text-xs text-gray-400 mt-0.5">{a.net >= 0 ? 'partner moet ons betalen' : 'wij moeten partner betalen'}</div>
                </div>
                <div className="flex items-center gap-5 shrink-0">
                  <div className="text-right hidden sm:block">
                    <div className="text-[11px] text-gray-400">Wij betalen</div>
                    <div className="text-sm font-semibold text-green-600">{formatEuro(Math.max(0, a.openToPartner))}</div>
                  </div>
                  <div className="text-right hidden sm:block">
                    <div className="text-[11px] text-gray-400">Partner betaalt</div>
                    <div className="text-sm font-semibold text-red-600">{formatEuro(Math.max(0, a.openByPartner))}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-gray-400">Netto</div>
                    <div className={`font-bold ${a.net >= 0 ? 'text-red-600' : 'text-green-600'}`}>{a.net >= 0 ? '+' : '−'}{formatEuro(Math.abs(a.net))}</div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-300" />
                </div>
              </Link>
            ))}
          </div>
        )}
        <p className="text-xs text-gray-400">Netto positief = de partner moet ons betalen. Netto negatief = wij moeten de partner betalen. Klik een partner aan om betalingen te registreren of goed te keuren.</p>
      </div>
    </div>
  )
}
