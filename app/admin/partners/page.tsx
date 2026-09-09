export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import Link from 'next/link'
import { Plus, UserSquare2, Mail } from 'lucide-react'

const ROLE_LABELS: Record<string, string> = {
  photographer: 'Fotograaf',
  videographer: 'Videograaf',
  editor: 'Editor',
  designer: 'Designer',
  copywriter: 'Copywriter',
  developer: 'Developer',
  strategist: 'Strateeg',
  other: 'Overig',
}

async function getPartners() {
  try {
    const admin = createAdminSupabaseClient()
    const { data } = await admin
      .from('freelancers')
      .select('*, freelancer_assignments(id, status)')
      .order('created_at', { ascending: false })
    return data ?? []
  } catch {
    return []
  }
}

export default async function PartnersPage() {
  const partners = await getPartners()

  const activeCount = partners.filter((p) => p.active).length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Partners</h1>
          <p className="text-sm text-gray-500 mt-0.5">{activeCount} actieve partners</p>
        </div>
        <Link href="/admin/partners/new" className="btn-primary">
          <Plus className="h-4 w-4" />
          Partner toevoegen
        </Link>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        {partners.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <UserSquare2 className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Nog geen partners aangemaakt</p>
            <Link href="/admin/partners/new" className="btn-primary mt-4 inline-flex">
              <Plus className="h-4 w-4" />
              Eerste partner toevoegen
            </Link>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="table-th">Partner</th>
                <th className="table-th">Rollen</th>
                <th className="table-th">Regio</th>
                <th className="table-th">Opdrachten</th>
                <th className="table-th">Commissie</th>
                <th className="table-th">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {partners.map((p) => {
                const assignments = (p.freelancer_assignments as Array<{ id: string; status: string }> ?? [])
                const activeAssignments = assignments.filter((a) => ['in_progress', 'open'].includes(a.status))
                return (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    <td className="table-td">
                      <Link href={`/admin/partners/${p.id}`} className="block group">
                        <div className="font-medium group-hover:text-black">{p.name}</div>
                        {p.company && <div className="text-xs text-gray-400">{p.company}</div>}
                        <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5">
                          <Mail className="h-3 w-3" />
                          {p.email}
                        </div>
                      </Link>
                    </td>
                    <td className="table-td">
                      <div className="flex flex-wrap gap-1">
                        {(p.roles as string[] ?? []).slice(0, 3).map((r) => (
                          <span key={r} className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded-full">
                            {ROLE_LABELS[r] ?? r}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="table-td text-gray-500">{p.region || '—'}</td>
                    <td className="table-td">
                      <span className="font-medium">{activeAssignments.length}</span>
                      <span className="text-gray-400 text-xs"> actief</span>
                    </td>
                    <td className="table-td">
                      {p.commission_pct != null
                        ? `${p.commission_pct}%`
                        : '—'}
                    </td>
                    <td className="table-td">
                      <span className={`status-badge ${p.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {p.active ? 'Actief' : 'Inactief'}
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
