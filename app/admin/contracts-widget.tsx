import Link from 'next/link'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { FileSignature, ArrowRight, Bell } from 'lucide-react'
import { canonicalStatus, followUp } from '@/lib/contract-status'

// Command Center-widget: contractstatussen in één oogopslag + opvolging (geen automail).
export async function ContractsWidget() {
  let admin: ReturnType<typeof createAdminSupabaseClient> | null = null
  try { admin = createAdminSupabaseClient() } catch { return null }

  const { data } = await admin
    .from('contracts')
    .select('id, title, status, sent_at, created_at, expires_at, client_id')
    .order('created_at', { ascending: false })
    .limit(500)

  const rows = data ?? []
  if (rows.length === 0) return null

  const key = (s: string) => canonicalStatus(s)
  const counts = {
    toSign:  rows.filter((c) => ['verzonden', 'geopend', 'ingevuld'].includes(key(c.status))).length,
    expired: rows.filter((c) => key(c.status) === 'verlopen').length,
    sent:    rows.filter((c) => key(c.status) === 'verzonden').length,
    signed:  rows.filter((c) => key(c.status) === 'getekend').length,
  }
  const followUps = rows.map((c) => ({ c, fu: followUp(c) })).filter((x) => x.fu.needs).slice(0, 3)

  const Cell = ({ value, label, cls, href }: { value: number; label: string; cls: string; href: string }) => (
    <Link href={href} className="rounded-xl border border-gray-100 bg-white p-3 text-center hover:bg-gray-50 transition-colors">
      <div className={`text-2xl font-bold ${cls}`}>{value}</div>
      <div className="text-[11px] text-gray-400 mt-0.5">{label}</div>
    </Link>
  )

  return (
    <div className="card-base">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 text-sm flex items-center gap-2">
          <FileSignature className="h-4 w-4 text-gray-400" />
          Contracten
        </h2>
        <Link href="/admin/contracts" className="text-xs text-gray-400 hover:text-black flex items-center gap-1">
          Alles <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <Cell value={counts.toSign}  label="Te tekenen" cls="text-amber-600" href="/admin/contracts?status=verzonden" />
        <Cell value={counts.expired} label="Verlopen"   cls="text-red-600"   href="/admin/contracts?status=verlopen" />
        <Cell value={counts.sent}    label="Verzonden"  cls="text-blue-600"  href="/admin/contracts?status=verzonden" />
        <Cell value={counts.signed}  label="Getekend"   cls="text-green-600" href="/admin/contracts?status=getekend" />
      </div>

      {followUps.length > 0 && (
        <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700">
            <Bell className="h-3.5 w-3.5" />
            Vereist opvolging
          </div>
          {followUps.map(({ c, fu }) => (
            <Link key={c.id} href={`/admin/contracts/${c.id}`} className="flex items-center justify-between gap-2 text-xs py-1 px-2 rounded-lg hover:bg-gray-50">
              <span className="truncate text-gray-700">{c.title}</span>
              <span className={`shrink-0 status-badge ${fu.level === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{fu.reason}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
