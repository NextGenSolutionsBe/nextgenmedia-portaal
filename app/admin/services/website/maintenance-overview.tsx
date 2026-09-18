import Link from 'next/link'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { maintenanceStatus, formatNL, type MaintenanceClient } from '@/lib/maintenance'
import { Wrench, AlertTriangle, Globe, Code2 } from 'lucide-react'

// Overzicht van alle lopende onderhoudspakketten: wie heeft onderhoud en hoe
// lang nog. Bijna-afgelopen en verlopen pakketten staan bovenaan, want dat is
// waar actie op nodig is.
export async function MaintenanceOverview() {
  const admin = createAdminSupabaseClient()
  const { data } = await admin
    .from('clients')
    .select('*')
    .eq('maintenance_included', true)

  const rows = ((data ?? []) as (MaintenanceClient & { website_url?: string | null; website_platform?: string | null })[])
    .map((c) => ({ client: c, status: maintenanceStatus(c) }))
    .sort((a, b) => {
      // Zonder einddatum (startdatum ontbreekt) eerst — die moeten ingevuld worden.
      if (a.status.daysLeft === null) return -1
      if (b.status.daysLeft === null) return 1
      return a.status.daysLeft - b.status.daysLeft
    })

  if (rows.length === 0) return null

  const needsAttention = rows.filter((r) => r.status.expired || r.status.expiringSoon || r.status.daysLeft === null).length

  return (
    <div className="card-base">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <Wrench className="h-4 w-4 text-gray-400" />Onderhoud
          <span className="text-xs font-normal text-gray-500">· {rows.length} klant(en)</span>
        </h2>
        {needsAttention > 0 && (
          <span className="status-badge bg-amber-100 text-amber-700 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" />{needsAttention} vraagt aandacht
          </span>
        )}
      </div>

      <div className="table-wrap">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              <th className="table-th">Klant</th>
              <th className="table-th">Type</th>
              <th className="table-th">Start</th>
              <th className="table-th">Loopt tot</th>
              <th className="table-th">Resterend</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(({ client, status }) => {
              const tone = status.expired ? 'text-red-600' : status.expiringSoon ? 'text-amber-600' : 'text-gray-700'
              return (
                <tr key={client.id} className="hover:bg-gray-50">
                  <td className="table-td">
                    <Link href={`/admin/clients/${client.id}`} className="font-medium hover:underline">{client.company_name}</Link>
                  </td>
                  <td className="table-td">
                    <span className="inline-flex items-center gap-1 text-xs text-gray-600">
                      {client.website_platform === 'custom'
                        ? <><Code2 className="h-3 w-3" />Custom code</>
                        : client.website_platform === 'framer'
                          ? <><Globe className="h-3 w-3" />Framer</>
                          : <span className="text-gray-400">—</span>}
                    </span>
                  </td>
                  <td className="table-td text-gray-600">
                    {status.startDate ? formatNL(new Date(`${status.startDate}T00:00:00.000Z`)) : <span className="text-amber-600">nog invullen</span>}
                  </td>
                  <td className="table-td text-gray-600">
                    {status.endDate ? formatNL(new Date(`${status.endDate}T00:00:00.000Z`)) : '—'}
                  </td>
                  <td className={`table-td font-medium ${tone}`}>
                    {status.daysLeft === null
                      ? 'Startdatum ontbreekt'
                      : status.expired
                        ? 'Verlopen'
                        : `${status.daysLeft} ${status.daysLeft === 1 ? 'dag' : 'dagen'}`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] text-gray-400 mt-2">We krijgen automatisch een interne mail zodra een pakket binnen een maand afloopt.</p>
    </div>
  )
}
