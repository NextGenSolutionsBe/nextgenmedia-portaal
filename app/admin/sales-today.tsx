import Link from 'next/link'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { getOrCreateSalesOrg } from '@/lib/sales/service'
import { PhoneCall, CalendarClock, ArrowRight, Target } from 'lucide-react'

// Command Center-blok voor de Verkoop-module: wat staat er vandaag te doen in
// de pipeline. Dit is het startscherm van een appointment setter, die verder
// niets van het platform ziet.
export async function SalesToday() {
  let admin: ReturnType<typeof createAdminSupabaseClient>
  let pipelineId: string
  try {
    admin = createAdminSupabaseClient()
    pipelineId = (await getOrCreateSalesOrg()).id
  } catch { return null }

  const now = new Date()
  const endOfDay = new Date(now); endOfDay.setHours(23, 59, 59, 999)
  const weekAhead = new Date(now.getTime() + 7 * 86400000)

  const [{ count: toCall }, { count: callbacks }, { count: appts }] = await Promise.all([
    admin.from('sales_leads').select('id', { count: 'exact', head: true })
      .eq('sales_client_id', pipelineId).eq('stage_key', 'to_contact')
      .is('archived_at', null).eq('do_not_call', false),
    admin.from('sales_leads').select('id', { count: 'exact', head: true })
      .eq('sales_client_id', pipelineId).is('archived_at', null)
      .not('callback_at', 'is', null).lte('callback_at', endOfDay.toISOString()),
    admin.from('sales_appointments').select('id', { count: 'exact', head: true })
      .eq('sales_client_id', pipelineId).eq('status', 'scheduled')
      .gte('starts_at', now.toISOString()).lte('starts_at', weekAhead.toISOString()),
  ])

  const rows = [
    { icon: PhoneCall, n: callbacks ?? 0, label: 'terugbellen vandaag', href: '/admin/sales/pipeline', accent: 'text-amber-600' },
    { icon: Target, n: toCall ?? 0, label: 'leads nog te contacteren', href: '/admin/sales/pipeline', accent: 'text-gray-700' },
    { icon: CalendarClock, n: appts ?? 0, label: 'afspraken komende 7 dagen', href: '/admin/sales/appointments', accent: 'text-green-600' },
  ].filter((r) => r.n > 0)

  return (
    <div className="card-base">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold text-gray-900 flex items-center gap-2">
          <PhoneCall className="h-4 w-4 text-[#caa800]" />Verkoop
        </h2>
        <Link href="/admin/sales/pipeline" className="text-xs text-gray-500 hover:text-black">Naar de pipeline</Link>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 py-2">Nog niets in de pipeline. Voeg leads toe of importeer een lijst.</p>
      ) : (
        <div className="space-y-1">
          {rows.map((r, i) => (
            <Link key={i} href={r.href} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50 group">
              <r.icon className="h-4 w-4 text-gray-400 shrink-0" />
              <span className="text-sm text-gray-800">
                <span className={`font-bold ${r.accent}`}>{r.n}</span> {r.label}
              </span>
              <ArrowRight className="h-3.5 w-3.5 text-gray-300 ml-auto group-hover:text-gray-500" />
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
