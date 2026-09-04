export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { formatEuro, formatDate, SERVICE_LABELS } from '@/lib/utils'
import { FileText, Hourglass, Repeat2, CalendarClock } from 'lucide-react'
import { loadCore, readPeriodParams } from '@/lib/finance-data'
import { revActive, toMonthly } from '@/lib/finance'
import { Kpi } from '../kpi'

export default async function ContractwaardePage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { year } = readPeriodParams(await searchParams)
  const c = await loadCore(year)
  const now = new Date()

  const monthsCount = (start: string, end: string | null): number => {
    const s = new Date(start)
    if (!end) return 24
    const e = new Date(end)
    return Math.max(1, (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth()) + 1)
  }

  // Actieve contractwaarde: volledige waarde van actieve recurring contracten
  const activeContractValue = c.entries
    .filter(e => e.type === 'recurring' && e.start_month && revActive(e, now.getFullYear(), now.getMonth()))
    .reduce((s, e) => s + toMonthly(e.amount_per_month ?? 0, e.billing_frequency) * monthsCount(e.start_month!, e.end_month), 0)

  const recurringWaarde = c.remainingRecurring
  const futureOneTime = c.entries
    .filter(e => e.type === 'one_time' && e.amount && e.transaction_month && new Date(e.transaction_month) > now)
    .reduce((s, e) => s + (e.amount ?? 0), 0)
  const nogTeFactureren = recurringWaarde + futureOneTime

  // Contractverval — uit service_contracts (binnen 120 dagen / verlopen)
  const admin = createAdminSupabaseClient()
  const { data: scRows } = await admin
    .from('service_contracts')
    .select('id, client_id, service_slug, end_date')
    .not('end_date', 'is', null)
    .order('end_date', { ascending: true })
    .limit(60)
  const todayMs = Date.now()
  const expiring = (scRows ?? [])
    .map((sc: { id: string; client_id: string; service_slug: string; end_date: string }) => ({
      ...sc, daysLeft: Math.round((new Date(sc.end_date).getTime() - todayMs) / 86400000),
      client_name: c.clientMap.get(sc.client_id) ?? '—',
    }))
    .filter(sc => sc.daysLeft <= 120)
    .sort((a, b) => a.daysLeft - b.daysLeft)

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Kpi label="Actieve contractwaarde" value={formatEuro(activeContractValue)} sub="volledige waarde actieve contracten" color="text-green-600" Icon={FileText} />
        <Kpi label="Nog te factureren" value={formatEuro(nogTeFactureren)} sub="nog niet gerealiseerd" color="text-blue-600" Icon={Hourglass} />
        <Kpi label="Recurring waarde" value={formatEuro(recurringWaarde)} sub="toekomstige recurring omzet" color="text-blue-600" Icon={Repeat2} />
        <Kpi label="Contracten aflopend" value={String(expiring.length)} sub="binnen 120 dagen" color="text-amber-600" Icon={CalendarClock} />
      </div>

      <div className="card-base">
        <h2 className="font-semibold mb-4 flex items-center gap-2"><CalendarClock className="h-4 w-4 text-gray-400" />Contractverval</h2>
        {expiring.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-8">Geen contracten die binnenkort aflopen</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead><tr className="border-b border-gray-100">
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Klant</th>
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Dienst</th>
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Einddatum</th>
                <th className="text-right py-2 text-xs text-gray-500 font-medium">Resterend</th>
              </tr></thead>
              <tbody className="divide-y divide-gray-50">
                {expiring.map(sc => {
                  const expired = sc.daysLeft < 0
                  const critical = !expired && sc.daysLeft <= 30
                  return (
                    <tr key={sc.id} className="hover:bg-gray-50/50">
                      <td className="py-2.5 font-medium">{sc.client_name}</td>
                      <td className="py-2.5 text-gray-500 capitalize">{SERVICE_LABELS[sc.service_slug] ?? sc.service_slug?.replace(/-/g, ' ')}</td>
                      <td className="py-2.5 text-gray-500">{formatDate(sc.end_date)}</td>
                      <td className="py-2.5 text-right">
                        <span className={`status-badge text-xs ${expired ? 'bg-red-100 text-red-700' : critical ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
                          {expired ? `${Math.abs(sc.daysLeft)}d verlopen` : `${sc.daysLeft}d`}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
