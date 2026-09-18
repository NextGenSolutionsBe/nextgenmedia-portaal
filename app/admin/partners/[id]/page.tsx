export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { notFound } from 'next/navigation'
import { formatEuro, formatDate } from '@/lib/utils'
import { computePartnerFinance } from '@/lib/partner-finance'
import { ArrowLeft, Briefcase, CheckCircle2, Clock, TrendingUp, Users, HandCoins, Repeat } from 'lucide-react'
import Link from 'next/link'
import { PartnerLedger } from './partner-ledger'
import { PartnerActions } from './partner-actions'
import { CredentialsCard } from '@/components/credentials-card'
import { CommissionDeals } from './commission-deals'
import { SettlementHistory } from './settlement-history'
import { PartnerPayments, type Payment } from './partner-payments'


const STATUS_STYLE: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-purple-100 text-purple-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-600',
}
const STATUS_LABEL: Record<string, string> = {
  open: 'Openstaand', in_progress: 'Actief', completed: 'Afgerond', cancelled: 'Geannuleerd',
}

const LEDGER_KIND_LABEL: Record<string, string> = {
  payout_owed: 'Uitbetaling aan partner',
  commission_owed: 'Commissie aan partner',
  service_billed: 'Partner heeft ons werk',
  manual_credit: 'Handmatig tegoed',
  manual_debit: 'Handmatige debet',
  settlement: 'Afrekening',
}

function Kpi({ label, value, sub, Icon }: { label: string; value: string | number; sub?: string; Icon?: React.ElementType }) {
  return (
    <div className="rounded-xl border border-gray-100 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-gray-500">{Icon && <Icon className="h-3.5 w-3.5 text-gray-400" />}{label}</div>
      <div className="mt-1 text-lg font-bold">{value}</div>
      {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
    </div>
  )
}

export default async function PartnerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const admin = createAdminSupabaseClient()

  // Fetch the partner first — this determines whether the page is a 404.
  // Use select('*') so a missing column never turns into a silent null result.
  const { data: partner } = await admin
    .from('freelancers')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (!partner) notFound()

  // Secondary data — Supabase queries resolve with { data, error } instead of
  // throwing, so a missing table just yields null data (never crashes the page).
  const [
    { data: assignmentRows },
    { data: clientRows },
    { data: ledgerRows },
    { data: settlementRows },
    { data: commissionRows },
    { data: salesRows },
    { data: paymentRows },
  ] = await Promise.all([
    admin.from('freelancer_assignments')
      .select('*')
      .eq('freelancer_id', id)
      .order('created_at', { ascending: false }),
    admin.from('clients').select('id, company_name, customer_since, created_at').order('company_name'),
    admin.from('partner_ledger_entries')
      .select('*')
      .eq('freelancer_id', id)
      .order('created_at', { ascending: false })
      .limit(50),
    admin.from('partner_settlements')
      .select('*')
      .eq('freelancer_id', id)
      .order('created_at', { ascending: false })
      .limit(10),
    admin.from('partner_commission_deals')
      .select('*')
      .eq('freelancer_id', id)
      .order('created_at', { ascending: false }),
    admin.from('partner_commission_sales')
      .select('*')
      .eq('freelancer_id', id)
      .order('sale_date', { ascending: false }),
    admin.from('partner_payments')
      .select('*')
      .eq('freelancer_id', id)
      .order('created_at', { ascending: false }),
  ])

  const clientMap = new Map((clientRows ?? []).map((c) => [c.id, c]))
  const all = (assignmentRows ?? []).map((a) => ({
    ...a,
    client: a.client_id ? (clientMap.get(a.client_id) ?? null) : null,
  }))
  const completed = all.filter((a) => a.status === 'completed')
  const active = all.filter((a) => a.status === 'in_progress')
  const totalEarned = completed.reduce((s, a) => s + (a.payout ?? 0), 0)

  const ledger = (ledgerRows ?? []) as Array<{
    id: string; kind: string; status: string; amount: number; description: string | null;
    client_id: string | null; occurred_on: string; created_at: string; settlement_id: string | null;
    direction?: string | null; commission_deal_id?: string | null; commission_year?: number | null;
  }>
  const commissionDeals = (commissionRows ?? []) as Array<{
    id: string; client_id: string | null; label: string | null; service_slug: string | null;
    contract_value: number; direction?: string | null; start_date: string; pct_year_1: number; pct_year_2: number; pct_year_3: number;
    status: string; notes: string | null; created_at: string;
  }>
  const commissionSales = (salesRows ?? []) as Array<{
    id: string; deal_id: string; service_slug: string | null; description: string | null;
    sale_amount: number; sale_date: string; commission_year: number; commission_pct: number;
    commission_amount: number; ledger_id: string | null;
  }>
  const settlements = (settlementRows ?? []) as Array<{
    id: string; period_start: string; period_end: string; net_amount: number; status: string; notes: string | null; finalized_at: string | null; paid_at: string | null;
  }>

  // Direction is explicit when present, otherwise inferred from the amount sign.
  const dirOf = (l: { direction?: string | null; amount: number }): 'we_pay_partner' | 'partner_pays_us' =>
    l.direction === 'partner_pays_us' || l.direction === 'we_pay_partner'
      ? l.direction
      : (l.amount >= 0 ? 'we_pay_partner' : 'partner_pays_us')

  const payments = (paymentRows ?? []) as Payment[]
  const fin = computePartnerFinance({ ledger, payments, deals: commissionDeals, sales: commissionSales })

  // Group sales per referral deal
  const salesByDeal: Record<string, typeof commissionSales> = {}
  for (const s of commissionSales) {
    ;(salesByDeal[s.deal_id] ??= []).push(s)
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/admin/partners" className="p-2 rounded-lg hover:bg-gray-100 shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold truncate">{partner.name}</h1>
          <p className="text-sm text-gray-500">{partner.company ?? partner.email}</p>
        </div>
        <span className={`status-badge shrink-0 ${partner.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
          {partner.active ? 'Actief' : 'Inactief'}
        </span>
        <PartnerActions partnerId={partner.id} partnerName={partner.name} active={partner.active} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Info column */}
        <div className="space-y-4">
        <div className="card-base space-y-3">
          <h2 className="font-semibold text-gray-900">Gegevens</h2>
          <div className="space-y-2 text-sm">
            {[
              ['E-mail', partner.email],
              partner.phone && ['Telefoon', partner.phone],
              partner.company && ['Bedrijf', partner.company],
              partner.vat_number && ['BTW', partner.vat_number],
              partner.iban && ['IBAN', partner.iban],
              partner.region && ['Regio', partner.region],
              ['Partner sinds', formatDate(partner.created_at)],
            ].filter(Boolean).map(([k, v]) => (
              <div key={k as string} className="flex justify-between gap-4">
                <span className="text-gray-500 shrink-0">{k as string}</span>
                <span className="font-medium text-right break-all">{v as string}</span>
              </div>
            ))}
          </div>

          {/* Default commission tiers — informational. Actual % is set per deal. */}
          <div className="pt-2 border-t border-gray-100">
            <p className="text-xs text-gray-500 mb-2">Standaard commissie per aangeleverde klant</p>
            <div className="flex gap-2">
              {[
                { label: 'Jaar 1', pct: 10 },
                { label: 'Jaar 2', pct: 8 },
                { label: 'Jaar 3+', pct: 5 },
              ].map(t => (
                <div key={t.label} className="flex-1 text-center py-2 rounded-lg border border-gray-200 text-xs font-medium text-gray-600">
                  <div className="text-lg font-bold">{t.pct}%</div>
                  <div>{t.label}</div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-1.5">
              Percentages tellen per actief jaar van de klant en zijn per deal aanpasbaar.
            </p>
          </div>

          {Array.isArray(partner.roles) && partner.roles.length > 0 && (
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs text-gray-500 mb-1.5">Rollen</p>
              <div className="flex gap-1 flex-wrap">
                {(partner.roles as string[]).map((r) => (
                  <span key={r} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">{r}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Login credentials */}
        <CredentialsCard
          endpoint={`/api/admin/partners/${id}/credentials`}
          email={partner.email ?? null}
        />
        </div>

        {/* Stats */}
        <div className="lg:col-span-2 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="stat-card">
              <div className="flex items-center gap-1.5 mb-1">
                <Briefcase className="h-3.5 w-3.5 text-gray-400" />
                <span className="text-xs text-gray-500">Opdrachten</span>
              </div>
              <div className="text-2xl font-bold">{all.length}</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-1.5 mb-1">
                <Clock className="h-3.5 w-3.5 text-purple-500" />
                <span className="text-xs text-gray-500">Actief</span>
              </div>
              <div className="text-2xl font-bold">{active.length}</div>
            </div>
            <div className="stat-card">
              <div className="flex items-center gap-1.5 mb-1">
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                <span className="text-xs text-gray-500">Afgerond</span>
              </div>
              <div className="text-2xl font-bold">{completed.length}</div>
            </div>
            <div className="stat-card">
              <div className="text-xs text-gray-500 mb-1">Uitbetaald</div>
              <div className="text-xl font-bold">{formatEuro(totalEarned)}</div>
            </div>
          </div>

          {/* Openstaand saldo — partner betaalt ons MIN wij betalen partner */}
          <div className="card-base">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm">Openstaand saldo</h3>
              <TrendingUp className="h-4 w-4 text-gray-400" />
            </div>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Partner betaalt ons</div>
                <div className="text-lg font-bold text-red-600">{formatEuro(fin.openByPartner)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Wij betalen partner</div>
                <div className="text-lg font-bold text-green-600">{formatEuro(fin.openToPartner)}</div>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-0.5">Netto saldo</div>
                <div className={`text-lg font-bold ${fin.net >= 0 ? 'text-red-600' : 'text-green-600'}`}>
                  {fin.net >= 0 ? '+' : '−'}{formatEuro(Math.abs(fin.net))}
                </div>
                <div className="text-[10px] text-gray-400 mt-0.5">{fin.net > 0 ? 'partner betaalt ons' : fin.net < 0 ? 'wij betalen partner' : 'vereffend'}</div>
              </div>
            </div>
          </div>

          {/* Samenwerking-KPI's */}
          <div className="card-base">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2"><Users className="h-4 w-4 text-gray-400" />Samenwerking</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Kpi label="Wij → partner (klanten)" value={fin.clientsWeReferred} sub={`${formatEuro(fin.revenueWeReferred)} omzet`} />
              <Kpi label="Partner → ons (klanten)" value={fin.clientsPartnerReferred} sub={`${formatEuro(fin.revenuePartnerReferred)} omzet`} />
              <Kpi label="Onderaanneming" value={fin.subToPartnerCount + fin.subByPartnerCount} sub={`${formatEuro(fin.subToPartnerTotal + fin.subByPartnerTotal)}`} Icon={Repeat} />
              <Kpi label="Commissie wij verdienen" value={formatEuro(fin.commissionWeEarned)} Icon={HandCoins} />
              <Kpi label="Commissie partner verdient" value={formatEuro(fin.commissionPartnerEarned)} Icon={HandCoins} />
              <Kpi label="Open saldo (netto)" value={`${fin.net >= 0 ? '+' : '−'}${formatEuro(Math.abs(fin.net))}`} />
            </div>
          </div>
        </div>
      </div>

      {/* Commission deals — per referred client, year 1/2/3 % editable */}
      <div id="commissie" className="scroll-mt-20" />
      <CommissionDeals
        partnerId={id}
        clients={(clientRows ?? []).map((c) => ({
          id: c.id,
          company_name: c.company_name,
          customer_since: (c.customer_since ?? c.created_at ?? null) as string | null,
        }))}
        deals={commissionDeals}
        salesByDeal={salesByDeal}
      />

      {/* Ledger actions (Client Component) */}
      <PartnerLedger
        partnerId={id}
        clients={(clientRows ?? []).map(c => ({ id: c.id, company_name: c.company_name }))}
      />

      {/* Ledger history */}
      {ledger.length > 0 && (
        <div className="card-base">
          <h2 className="font-semibold mb-4">Ledger historie</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="text-left py-2 text-xs text-gray-500 font-medium">Datum</th>
                  <th className="text-left py-2 text-xs text-gray-500 font-medium">Richting</th>
                  <th className="text-left py-2 text-xs text-gray-500 font-medium">Type</th>
                  <th className="text-left py-2 text-xs text-gray-500 font-medium">Omschrijving</th>
                  <th className="text-left py-2 text-xs text-gray-500 font-medium">Klant</th>
                  <th className="text-right py-2 text-xs text-gray-500 font-medium">Bedrag</th>
                  <th className="text-left py-2 text-xs text-gray-500 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {ledger.map(l => {
                  const dir = dirOf(l)
                  const wePay = dir === 'we_pay_partner'
                  return (
                  <tr key={l.id} className="hover:bg-gray-50/50">
                    <td className="py-2.5 text-gray-500 text-xs">{formatDate(l.occurred_on)}</td>
                    <td className="py-2.5">
                      <span className={`status-badge text-xs ${wePay ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                        {wePay ? 'Wij betalen' : 'Partner betaalt'}
                      </span>
                    </td>
                    <td className="py-2.5">
                      <span className="text-xs text-gray-600">{LEDGER_KIND_LABEL[l.kind] ?? l.kind}</span>
                    </td>
                    <td className="py-2.5 text-gray-700 max-w-[200px] truncate">{l.description ?? '—'}</td>
                    <td className="py-2.5 text-gray-500 text-xs">
                      {l.client_id ? (clientMap.get(l.client_id)?.company_name ?? '—') : '—'}
                    </td>
                    <td className={`py-2.5 text-right font-semibold ${wePay ? 'text-green-600' : 'text-red-600'}`}>
                      {wePay ? '+' : '−'}{formatEuro(Math.abs(l.amount))}
                    </td>
                    <td className="py-2.5">
                      <span className={`status-badge text-xs ${
                        l.status === 'settled' ? 'bg-green-100 text-green-700' :
                        l.status === 'cancelled' ? 'bg-gray-100 text-gray-600' :
                        'bg-amber-100 text-amber-700'
                      }`}>
                        {l.status === 'settled' ? 'Afgerekend' : l.status === 'cancelled' ? 'Geannuleerd' : 'Openstaand'}
                      </span>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Betalingen — registreren + goedkeuren/annuleren */}
      <PartnerPayments partnerId={id} payments={payments} />

      {/* Settlements — legacy afrekenhistorie (alleen indien aanwezig) */}
      <SettlementHistory partnerId={id} settlements={settlements} />

      {/* Assignments */}
      <div className="card-base">
        <h2 className="font-semibold text-gray-900 mb-4">Opdrachtenhistorie</h2>
        {all.length === 0 ? (
          <div className="text-center py-10 text-gray-400">
            <Briefcase className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nog geen opdrachten</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th">Opdracht</th>
                  <th className="table-th">Klant</th>
                  <th className="table-th">Status</th>
                  <th className="table-th">Deadline</th>
                  <th className="table-th text-right">Uitbetaling</th>
                </tr>
              </thead>
              <tbody>
                {all.map((a) => (
                  <tr key={a.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="table-td font-medium">{a.title}</td>
                    <td className="table-td text-gray-500">{a.client?.company_name ?? '—'}</td>
                    <td className="table-td">
                      <span className={`status-badge ${STATUS_STYLE[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LABEL[a.status] ?? a.status}
                      </span>
                    </td>
                    <td className="table-td text-gray-500">{a.deadline ? formatDate(a.deadline) : '—'}</td>
                    <td className="table-td text-right font-semibold">{a.payout != null ? formatEuro(a.payout) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
