export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import { Send } from 'lucide-react'

const STATUS: Record<string, { label: string; cls: string }> = {
  sent: { label: 'Verzonden', cls: 'bg-blue-100 text-blue-700' },
  delivered: { label: 'Afgeleverd', cls: 'bg-green-100 text-green-700' },
  error: { label: 'Fout', cls: 'bg-red-100 text-red-700' },
}

export default async function SentMailsPage() {
  let rows: Array<{
    id: string; created_at: string; to_email: string; subject: string; template_name: string | null
    sent_by_email: string | null; status: string; error: string | null
  }> = []
  try {
    const admin = createAdminSupabaseClient()
    const { data } = await admin.from('email_messages').select('*').eq('audience', 'client').order('created_at', { ascending: false }).limit(200)
    rows = (data ?? []) as typeof rows
  } catch { /* tabel ontbreekt */ }

  return (
    <div className="card-base">
      {rows.length === 0 ? (
        <div className="text-center text-gray-400 py-10">
          <Send className="h-8 w-8 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Nog geen mails verstuurd naar klanten.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Datum</th>
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Ontvanger</th>
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Onderwerp</th>
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Template</th>
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Verzonden door</th>
                <th className="text-left py-2 text-xs text-gray-500 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {rows.map((m) => {
                const st = STATUS[m.status] ?? { label: m.status, cls: 'bg-gray-100 text-gray-600' }
                return (
                  <tr key={m.id} className="hover:bg-gray-50/50">
                    <td className="py-2.5 text-gray-500 text-xs whitespace-nowrap">{formatDate(m.created_at)}</td>
                    <td className="py-2.5 text-gray-700 text-xs">{m.to_email}</td>
                    <td className="py-2.5 text-gray-800 max-w-[240px] truncate">{m.subject}</td>
                    <td className="py-2.5 text-gray-500 text-xs">{m.template_name ?? '—'}</td>
                    <td className="py-2.5 text-gray-500 text-xs">{m.sent_by_email ?? '—'}</td>
                    <td className="py-2.5">
                      <span className={`status-badge text-xs ${st.cls}`} title={m.error ?? undefined}>{st.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
