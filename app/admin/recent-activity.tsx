import Link from 'next/link'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { Activity } from 'lucide-react'

// Compacte recente activiteit uit het audit_log (read-only, gelimiteerd).
// Vervangt de zware losse widgets op het Command Center.
export async function RecentActivity() {
  let rows: { id: string; action: string; summary: string | null; entity_type: string | null; entity_id: string | null; actor_email: string | null; created_at: string }[] = []
  try {
    const admin = createAdminSupabaseClient()
    const { data } = await admin
      .from('audit_log')
      .select('id, action, summary, entity_type, entity_id, actor_email, created_at')
      .order('created_at', { ascending: false })
      .limit(12)
    rows = data ?? []
  } catch { return null }

  if (rows.length === 0) return null

  const hrefFor = (t: string | null, id: string | null): string | null => {
    if (!id) return null
    if (t === 'client') return `/admin/clients/${id}`
    if (t === 'contract') return `/admin/contracts/${id}`
    return null
  }

  return (
    <div className="card-base">
      <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2 mb-3">
        <Activity className="h-4 w-4 text-gray-400" />
        Recente activiteit
      </h2>
      <div className="space-y-1.5">
        {rows.map((r) => {
          const href = hrefFor(r.entity_type, r.entity_id)
          const when = new Date(r.created_at).toLocaleString('nl-BE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
          const body = (
            <div className="flex items-start gap-2 text-xs py-1">
              <span className="h-1.5 w-1.5 rounded-full bg-gray-300 mt-1.5 shrink-0" />
              <div className="min-w-0">
                <span className="text-gray-800">{r.summary || r.action}</span>
                <div className="text-gray-400">{when}{r.actor_email ? ` · ${r.actor_email}` : ''}</div>
              </div>
            </div>
          )
          return href
            ? <Link key={r.id} href={href} className="block rounded-lg hover:bg-gray-50 px-1">{body}</Link>
            : <div key={r.id} className="px-1">{body}</div>
        })}
      </div>
    </div>
  )
}
