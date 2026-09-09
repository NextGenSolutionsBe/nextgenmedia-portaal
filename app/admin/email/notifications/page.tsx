export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import { Bell, Clock } from 'lucide-react'
import { ReportNowButton } from './report-button'

const STATUS: Record<string, { label: string; cls: string }> = {
  sent: { label: 'Verzonden', cls: 'bg-green-100 text-green-700' },
  error: { label: 'Fout', cls: 'bg-red-100 text-red-700' },
}
const KIND_LABEL: Record<string, string> = {
  maintenance_alert: 'Onderhoudsaanvraag',
  script_alert: 'Scriptactiviteit',
  admin_notify: 'Samenvatting',
}

export default async function NotificationsPage() {
  let lastRun: string | null = null
  let rows: Array<{
    id: string; created_at: string; to_email: string; status: string
    trigger_type: string | null; item_count: number | null; kind: string | null
  }> = []
  try {
    const admin = createAdminSupabaseClient()
    const [{ data: state }, { data: msgs }] = await Promise.all([
      admin.from('admin_notify_state').select('last_run_at').eq('id', 'singleton').maybeSingle(),
      admin.from('email_messages').select('id, created_at, to_email, status, trigger_type, item_count, kind').eq('audience', 'admin').order('created_at', { ascending: false }).limit(50),
    ])
    lastRun = state?.last_run_at ?? null
    rows = (msgs ?? []) as typeof rows
  } catch { /* tabel ontbreekt */ }

  return (
    <div className="space-y-4">
      <div className="card-base">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold text-sm flex items-center gap-2"><Bell className="h-4 w-4 text-gray-400" />Admin-meldingen</h2>
            <p className="text-sm text-gray-500 mt-1 max-w-2xl">
              Admins krijgen direct een mail bij een nieuwe onderhoudsaanvraag, en bij scriptfeedback/goedkeuringen (max één mail per klant per uur om spam te voorkomen). Je kan ook manueel een volledig rapport opvragen.
              <span className="block mt-1 text-gray-400">Deze meldingen gaan uitsluitend naar admins — nooit naar klanten.</span>
            </p>
          </div>
          <ReportNowButton />
        </div>
        <div className="mt-3 inline-flex items-center gap-1.5 text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-2.5 py-1.5">
          <Clock className="h-3.5 w-3.5" />Laatste rapport: {lastRun ? formatDate(lastRun) : 'nog niet verstuurd'}
        </div>
      </div>

      <div className="card-base">
        <h3 className="font-semibold text-sm mb-3">Rapporthistoriek</h3>
        {rows.length === 0 ? (
          <p className="empty-state text-sm">Nog geen rapporten verstuurd.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="border-b border-gray-100">
                  <th className="table-th">Datum</th>
                  <th className="table-th">Soort</th>
                  <th className="table-th">Trigger</th>
                  <th className="table-th">Verzonden naar</th>
                  <th className="table-th">Items</th>
                  <th className="table-th">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((m) => {
                  const st = STATUS[m.status] ?? { label: m.status, cls: 'bg-gray-100 text-gray-600' }
                  return (
                    <tr key={m.id} className="hover:bg-gray-50/50">
                      <td className="table-td text-gray-500 text-xs whitespace-nowrap">{formatDate(m.created_at)}</td>
                      <td className="table-td text-gray-700 text-xs">{KIND_LABEL[m.kind ?? ''] ?? 'Melding'}</td>
                      <td className="table-td">
                        <span className="status-badge bg-gray-100 text-gray-600">{m.trigger_type === 'manual' ? 'Manueel' : m.trigger_type === 'event' ? 'Direct' : 'Automatisch'}</span>
                      </td>
                      <td className="table-td text-gray-500 text-xs max-w-[260px] truncate">{m.to_email}</td>
                      <td className="table-td">{m.item_count ?? 0}</td>
                      <td className="table-td"><span className={`status-badge ${st.cls}`}>{st.label}</span></td>
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
