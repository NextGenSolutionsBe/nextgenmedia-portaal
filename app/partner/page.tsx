export const dynamic = 'force-dynamic'

import { createClient, createAdminSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { formatEuro, formatDate } from '@/lib/utils'
import { Briefcase, CheckCircle2, Clock, AlertCircle, TrendingUp, Plus, ArrowDownLeft, ArrowUpRight, Wallet, HandCoins, Layers } from 'lucide-react'
import Link from 'next/link'
import { computePartnerFinance, type LedgerRow, type PaymentRow, type DealRow, type SaleRow } from '@/lib/partner-finance'

export default async function PartnerDashboard() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: partner } = await supabase
    .from('freelancers')
    .select('id, name, commission_pct, hourly_rate')
    .eq('user_id', user.id)
    .maybeSingle()
  if (!partner) redirect('/login')

  // Separate queries — no FK joins (avoids silent PostgREST failures)
  const { data: assignments } = await supabase
    .from('freelancer_assignments')
    .select('id, title, description, status, budget, payout, deadline, created_at, client_id')
    .eq('freelancer_id', partner.id)
    .order('created_at', { ascending: false })

  const admin = createAdminSupabaseClient()

  // Fetch client names via admin client (RLS prevents direct client access for partners)
  const clientIds = Array.from(new Set((assignments ?? []).map((a) => a.client_id).filter((v): v is string => !!v)))
  let clientMap = new Map<string, string>()
  if (clientIds.length > 0) {
    const { data: clients } = await admin.from('clients').select('id, company_name').in('id', clientIds)
    clientMap = new Map((clients ?? []).map((c) => [c.id, c.company_name]))
  }

  // Partner-boekhouding via DE centrale bron (computePartnerFinance) zodat het
  // partnerdashboard EXACT dezelfde commissie-, onderaannemings- en saldocijfers
  // toont als de admin-detailpagina en het settlements-overzicht.
  const [{ data: ledgerRows }, { data: paymentRows }, { data: dealRows }, { data: saleRows }] = await Promise.all([
    admin.from('partner_ledger_entries').select('*').eq('freelancer_id', partner.id),
    admin.from('partner_payments').select('*').eq('freelancer_id', partner.id),
    admin.from('partner_commission_deals').select('*').eq('freelancer_id', partner.id),
    admin.from('partner_commission_sales').select('*').eq('freelancer_id', partner.id),
  ])
  const fin = computePartnerFinance({
    ledger: (ledgerRows ?? []) as LedgerRow[],
    payments: (paymentRows ?? []) as PaymentRow[],
    deals: (dealRows ?? []) as DealRow[],
    sales: (saleRows ?? []) as SaleRow[],
  })
  // Vanuit het standpunt van de partner: ontvangen = wij betalen partner.
  const toReceive = fin.openToPartner
  const toPay = fin.openByPartner
  const net = fin.openToPartner - fin.openByPartner   // positief = partner ontvangt netto
  const lifetimeReceived = fin.paidToPartner

  const all = (assignments ?? []).map((a) => ({
    ...a,
    client_name: a.client_id ? (clientMap.get(a.client_id) ?? null) : null,
  }))

  const open = all.filter((a) => a.status === 'open')
  const active = all.filter((a) => a.status === 'in_progress')
  const done = all.filter((a) => a.status === 'completed')

  const STATUS_STYLE: Record<string, string> = {
    open: 'bg-blue-100 text-blue-700',
    in_progress: 'bg-purple-100 text-purple-700',
    completed: 'bg-green-100 text-green-700',
    cancelled: 'bg-gray-100 text-gray-600',
  }
  const STATUS_LABEL: Record<string, string> = {
    open: 'Openstaand', in_progress: 'Actief', completed: 'Afgerond', cancelled: 'Geannuleerd',
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-gray-500 mt-0.5">Welkom terug, {partner.name}</p>
        </div>
        <Link href="/partner/assignments" className="btn-primary">
          <Plus className="h-4 w-4" />
          Opdracht indienen
        </Link>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <AlertCircle className="h-4 w-4 text-blue-500" />
            <span className="text-xs text-gray-500 font-medium">Openstaand</span>
          </div>
          <div className="text-2xl font-bold">{open.length}</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="h-4 w-4 text-purple-500" />
            <span className="text-xs text-gray-500 font-medium">Actief</span>
          </div>
          <div className="text-2xl font-bold">{active.length}</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <CheckCircle2 className="h-4 w-4 text-green-500" />
            <span className="text-xs text-gray-500 font-medium">Afgerond</span>
          </div>
          <div className="text-2xl font-bold">{done.length}</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-green-500" />
            <span className="text-xs text-gray-500 font-medium">Totaal ontvangen</span>
          </div>
          <div className="text-2xl font-bold text-green-600">{formatEuro(lifetimeReceived)}</div>
        </div>
      </div>

      {/* Openstaand saldo — groen = u ontvangt, rood = u betaalt */}
      <div className="card-base">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h2 className="font-semibold text-gray-900 flex items-center gap-2">
            <Wallet className="h-4 w-4 text-[#c5b800]" />
            Openstaand saldo
          </h2>
          <Link href="/partner/settlements" className="text-xs text-gray-500 hover:text-black">
            Bekijk settlements →
          </Link>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center">
          <div className="rounded-xl border border-gray-100 p-3">
            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500 mb-1">
              <ArrowDownLeft className="h-3.5 w-3.5 text-green-500" />
              U ontvangt
            </div>
            <div className="text-xl font-bold text-green-600">{formatEuro(toReceive)}</div>
          </div>
          <div className="rounded-xl border border-gray-100 p-3">
            <div className="flex items-center justify-center gap-1.5 text-xs text-gray-500 mb-1">
              <ArrowUpRight className="h-3.5 w-3.5 text-red-500" />
              U betaalt
            </div>
            <div className="text-xl font-bold text-red-600">{formatEuro(toPay)}</div>
          </div>
          <div className="rounded-xl border border-gray-100 p-3">
            <div className="text-xs text-gray-500 mb-1">Netto saldo</div>
            <div className={`text-xl font-bold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {net >= 0 ? '+' : '−'}{formatEuro(Math.abs(net))}
            </div>
            <div className="text-[11px] text-gray-400 mt-0.5">{net >= 0 ? 'u ontvangt' : 'u betaalt ons'}</div>
          </div>
        </div>
      </div>

      {/* Commissie & onderaanneming — zelfde bron als de admin */}
      {(fin.commissionPartnerEarned > 0 || fin.subToPartnerTotal > 0 || fin.subByPartnerTotal > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="card-base">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><HandCoins className="h-4 w-4 text-[#c5b800]" />Commissie (doorverwijzingen)</h2>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Door u aangebrachte klanten</span><span className="font-medium">{fin.clientsPartnerReferred}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Omzet uit die klanten</span><span className="font-medium">{formatEuro(fin.revenuePartnerReferred)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Uw commissie</span><span className="font-bold text-green-600">{formatEuro(fin.commissionPartnerEarned)}</span></div>
            </div>
          </div>
          <div className="card-base">
            <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-3"><Layers className="h-4 w-4 text-gray-400" />Onderaanneming</h2>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Werk voor ons ({fin.subToPartnerCount})</span><span className="font-bold text-green-600">{formatEuro(fin.subToPartnerTotal)}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">Werk dat wij voor u deden ({fin.subByPartnerCount})</span><span className="font-bold text-red-600">{formatEuro(fin.subByPartnerTotal)}</span></div>
            </div>
          </div>
        </div>
      )}

      {/* Active & Open assignments */}
      <div className="card-base">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-semibold text-gray-900">Lopende opdrachten</h2>
          <Link href="/partner/assignments" className="text-xs text-gray-500 hover:text-black">
            Alle opdrachten →
          </Link>
        </div>
        {[...active, ...open].length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <Briefcase className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Geen actieve opdrachten</p>
            <Link href="/partner/assignments" className="btn-primary mt-4 inline-flex text-sm">
              <Plus className="h-4 w-4" />
              Opdracht indienen
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {[...active, ...open].map((a) => (
              <div key={a.id} className="flex items-start justify-between gap-3 p-3 rounded-xl border border-gray-100 hover:border-gray-200 transition-colors">
                <div className="min-w-0">
                  <div className="font-medium text-sm truncate">{a.title}</div>
                  {a.client_name && (
                    <div className="text-xs text-gray-400 mt-0.5">{a.client_name}</div>
                  )}
                  {a.deadline && (
                    <div className="text-xs text-gray-400 mt-0.5">Deadline: {formatDate(a.deadline)}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {(a.payout ?? a.budget) != null && (
                    <span className="text-sm font-semibold">{formatEuro(a.payout ?? a.budget)}</span>
                  )}
                  <span className={`status-badge ${STATUS_STYLE[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_LABEL[a.status] ?? a.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Commission info */}
      <div className="card-base">
        <h2 className="font-semibold text-gray-900 mb-3">Uw tarieven</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-gray-500">Commissie op referrals:</span>
            <span className="font-semibold ml-2">{partner.commission_pct ?? 10}%</span>
          </div>
          {partner.hourly_rate && (
            <div>
              <span className="text-gray-500">Uurtarief:</span>
              <span className="font-semibold ml-2">{formatEuro(partner.hourly_rate)}/u</span>
            </div>
          )}
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Wil je uw tarieven aanpassen? Neem contact op met NextGenMedia.
        </p>
      </div>
    </div>
  )
}
