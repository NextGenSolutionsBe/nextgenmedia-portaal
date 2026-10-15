import { KaartTabel } from '@/components/ui/kaart-tabel'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { formatEuro } from '@/lib/utils'
import { TrendingUp, Monitor } from 'lucide-react'

const PLATFORMS = ['Google Ads', 'Meta Ads', 'LinkedIn Ads']

type AdsConfig = {
  budget?: number
  platforms?: string[]
}

export default async function AdsAdminPage() {
  const admin = createAdminSupabaseClient()

  const [{ data: serviceRows }, { data: clientRows }] = await Promise.all([
    admin.from('client_services')
      .select('client_id, active, config')
      .eq('service_slug', 'ads')
      .eq('active', true),
    admin.from('clients').select('id, company_name'),
  ])

  const clientMap = new Map((clientRows ?? []).map((c) => [c.id, c]))

  const clients = (serviceRows ?? []).map((s) => ({
    id: s.client_id,
    company_name: clientMap.get(s.client_id)?.company_name ?? '—',
    config: (s.config ?? {}) as AdsConfig,
  }))

  const totalBudget = clients.reduce((sum, c) => sum + (c.config.budget ?? 0), 0)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Google Advertising</h1>
        <p className="text-sm text-gray-500 mt-0.5">Overzicht van advertentiebudgetten per klant</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <Monitor className="h-4 w-4 text-blue-500" />
            <span className="text-xs text-gray-500 font-medium">Actieve klanten</span>
          </div>
          <div className="text-2xl font-bold">{clients.length}</div>
        </div>
        <div className="stat-card">
          <div className="flex items-center gap-2 mb-1">
            <TrendingUp className="h-4 w-4 text-green-500" />
            <span className="text-xs text-gray-500 font-medium">Totaal maandbudget</span>
          </div>
          <div className="text-2xl font-bold">{formatEuro(totalBudget)}</div>
        </div>
      </div>

      {/* Client list */}
      <div className="card-base">
        <h2 className="font-semibold text-gray-900 mb-4">Klanten met Advertising</h2>
        {clients.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Monitor className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Geen klanten met actieve advertising dienst</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <KaartTabel><table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="table-th">Klant</th>
                  <th className="table-th">Platforms</th>
                  <th className="table-th text-right">Maandbudget</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                    <td className="table-td font-medium">{c.company_name}</td>
                    <td className="table-td">
                      <div className="flex gap-1 flex-wrap">
                        {(c.config.platforms ?? []).map((p) => (
                          <span key={p} className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">{p}</span>
                        ))}
                        {!c.config.platforms?.length && <span className="text-gray-400">—</span>}
                      </div>
                    </td>
                    <td className="table-td text-right font-semibold">
                      {c.config.budget ? formatEuro(c.config.budget) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></KaartTabel>
          </div>
        )}
      </div>
    </div>
  )
}
