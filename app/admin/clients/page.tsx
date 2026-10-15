export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { SERVICE_LABELS } from '@/lib/utils'
import Link from 'next/link'
import { Plus, Building2, Globe } from 'lucide-react'
import { ClientsSearch } from './clients-search'
import { leesVerantwoordelijken } from '@/lib/verkoop/verantwoordelijken'

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
  searchParams: Promise<{ q?: string; van?: string }>
}) {
  const { q, van } = await searchParams
  const [clients, namen] = await Promise.all([getClients(), leesVerantwoordelijken()])

  const filtered = clients.filter((c) => {
    // "Klant van": een naam, of '-' voor klanten zonder verantwoordelijke.
    if (van === '-' && c.sales_verantwoordelijke) return false
    if (van && van !== '-' && c.sales_verantwoordelijke !== van) return false
    if (!q) return true
    const search = q.toLowerCase()
    return (
      c.company_name?.toLowerCase().includes(search) ||
      c.niche?.toLowerCase().includes(search)
    )
  })
  const aantalVan = (n: string | null) => clients.filter((c) => (n === null ? !c.sales_verantwoordelijke : c.sales_verantwoordelijke === n)).length
  const filterHref = (v: string | null) => {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    if (v) p.set('van', v)
    const qs = p.toString()
    return `/admin/clients${qs ? `?${qs}` : ''}`
  }
  const chip = (aan: boolean) => `text-xs font-semibold px-3 py-1.5 rounded-xl border transition-colors ${aan ? 'bg-black text-white border-black' : 'border-gray-200 bg-white hover:bg-gray-50'}`

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

      {/* Klant van: wie is het aanspreekpunt / wiens klant is het */}
      <div className="flex items-center gap-1.5 flex-wrap -mt-2">
        <span className="text-xs text-gray-500 mr-1">Klant van:</span>
        <Link href={filterHref(null)} className={chip(!van)}>Iedereen ({clients.length})</Link>
        {namen.map((n) => <Link key={n} href={filterHref(n)} className={chip(van === n)}>{n} ({aantalVan(n)})</Link>)}
        <Link href={filterHref('-')} className={chip(van === '-')}>Nog niet gekozen ({aantalVan(null)})</Link>
      </div>

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
          <>
          {/* Telefoon: kaarten i.p.v. een tabel om zijwaarts door te scrollen */}
          <ul className="md:hidden divide-y divide-gray-100">
            {filtered.map((client) => {
              const services = (client.client_services as Array<{ service_slug: string; active: boolean }> ?? []).filter((s) => s.active)
              return (
                <li key={client.id}>
                  <Link href={`/admin/clients/${client.id}`} className="flex items-start justify-between gap-3 px-4 py-3 active:bg-gray-50">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{client.company_name}</div>
                      {client.niche && <div className="text-xs text-gray-400 mt-0.5 truncate">{client.niche}</div>}
                      {(client.sales_verantwoordelijke || client.appointment_setter) && (
                        <div className="text-[11px] text-gray-500 mt-0.5">
                          {client.sales_verantwoordelijke ? `Klant van ${client.sales_verantwoordelijke}` : ''}
                          {client.sales_verantwoordelijke && client.appointment_setter ? ' · ' : ''}
                          {client.appointment_setter ? `appointment: ${client.appointment_setter}` : ''}
                        </div>
                      )}
                      {services.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {services.map((sv) => <span key={sv.service_slug} className="inline-block px-2 py-0.5 bg-gray-100 text-gray-600 text-[11px] rounded-md">{SERVICE_LABELS[sv.service_slug] ?? sv.service_slug}</span>)}
                        </div>
                      )}
                    </div>
                    <span className="status-badge bg-green-100 text-green-700 shrink-0">Actief</span>
                  </Link>
                </li>
              )
            })}
          </ul>
          <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[500px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="table-th">Bedrijf</th>
                <th className="table-th">Diensten</th>
                <th className="table-th">Klant van</th>
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
                      {client.sales_verantwoordelijke
                        ? <div className="text-sm font-medium text-gray-900">{client.sales_verantwoordelijke}</div>
                        : <span className="text-gray-400">—</span>}
                      {client.appointment_setter && <div className="text-[11px] text-gray-500">appointment: {client.appointment_setter}</div>}
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
          </>
        )}
      </div>
    </div>
  )
}
