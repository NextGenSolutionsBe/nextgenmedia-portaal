export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { SERVICE_LABELS } from '@/lib/utils'
import Link from 'next/link'
import { Plus, Building2, Globe } from 'lucide-react'
import { ClientsSearch } from './clients-search'

async function getClients() {
  const admin = createAdminSupabaseClient()

  const [{ data: clientRows }, { data: serviceRows }] = await Promise.all([
    admin.from('clients').select('*').order('created_at', { ascending: false }),
    admin.from('client_services').select('client_id, service_slug, active'),
  ])

  const services = serviceRows ?? []

  return (clientRows ?? []).map((c) => ({
    ...c,
    client_services: services.filter((s) => s.client_id === c.id),
  }))
}

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const clients = await getClients()

  const filtered = clients.filter((c) => {
    if (!q) return true
    const search = q.toLowerCase()
    return (
      c.company_name?.toLowerCase().includes(search) ||
      c.niche?.toLowerCase().includes(search)
    )
  })

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Klanten</h1>
          <p className="text-sm text-gray-500 mt-0.5">{clients.length} klanten</p>
        </div>
        <Link href="/admin/clients/new" className="btn-primary">
          <Plus className="h-4 w-4" />
          Klant toevoegen
        </Link>
      </div>

      {/* Search */}
      <ClientsSearch defaultValue={q} />

      {/* Table */}
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Building2 className="h-8 w-8 mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              {q ? 'Geen klanten gevonden' : 'Nog geen klanten aangemaakt'}
            </p>
            {!q && (
              <Link href="/admin/clients/new" className="btn-primary mt-4 inline-flex">
                <Plus className="h-4 w-4" />
                Eerste klant toevoegen
              </Link>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="table-th">Bedrijf</th>
                <th className="table-th">Diensten</th>
                <th className="table-th">Contract</th>
                <th className="table-th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((client) => {
                const services = (client.client_services as Array<{ service_slug: string; active: boolean }> ?? [])
                  .filter((s) => s.active)

                return (
                  <tr key={client.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-td">
                      <Link href={`/admin/clients/${client.id}`} className="block group">
                        <div className="font-medium text-gray-900 group-hover:text-black">
                          {client.company_name}
                        </div>
                        {client.niche && (
                          <div className="text-xs text-gray-400 mt-0.5">{client.niche}</div>
                        )}
                        {client.website_url && (
                          <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                            <Globe className="h-3 w-3" />
                            {client.website_url.replace(/^https?:\/\//, '')}
                          </div>
                        )}
                      </Link>
                    </td>
                    <td className="table-td">
                      <div className="flex flex-wrap gap-1">
                        {services.map((s) => (
                          <span
                            key={s.service_slug}
                            className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-md"
                          >
                            {SERVICE_LABELS[s.service_slug] ?? s.service_slug}
                          </span>
                        ))}
                        {services.length === 0 && (
                          <span className="text-xs text-gray-400">—</span>
                        )}
                      </div>
                    </td>
                    <td className="table-td">
                      <span className="text-gray-400">—</span>
                    </td>
                    <td className="table-td">
                      <span className="status-badge bg-green-100 text-green-700">Actief</span>
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
