import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { formatDate } from '@/lib/utils'
import { Repeat, CalendarClock, Camera, FileBarChart, Flag, CalendarRange } from 'lucide-react'
import { buildLifecycle } from '@/lib/lifecycle'
import { nextReportingDate } from '@/lib/lifecycle-data'

export async function ClientLifecycleBlock({ clientId, companyName }: { clientId: string; companyName: string }) {
  const admin = createAdminSupabaseClient()
  const [{ data: contracts }, { data: shoots }, { data: svc }] = await Promise.all([
    admin.from('service_contracts').select('start_date, end_date, config').eq('client_id', clientId).eq('service_slug', 'social-media'),
    admin.from('shoot_briefings').select('shoot_date').eq('client_id', clientId).gte('shoot_date', new Date().toISOString().slice(0, 10)).order('shoot_date', { ascending: true }).limit(1),
    admin.from('client_services').select('active').eq('client_id', clientId).eq('service_slug', 'social-media').maybeSingle(),
  ])

  // Niet tonen als de klant geen social-media heeft
  if (!svc) return null

  const sc = (contracts ?? []).slice().sort((a, b) => (b.start_date ?? '').localeCompare(a.start_date ?? ''))[0]
  const months = sc?.config && typeof sc.config === 'object' ? Number((sc.config as Record<string, unknown>).contract_months) || null : null
  const lc = buildLifecycle({ clientId, companyName, startDate: sc?.start_date ?? null, contractMonths: months, endDate: sc?.end_date ?? null, hasPlanning: true })
  const nextShoot = shoots?.[0]?.shoot_date ?? null
  const nextReporting = nextReportingDate()

  const Row = ({ Icon, label, value, accent }: { Icon: React.ElementType; label: string; value: string; accent?: string }) => (
    <div className="flex items-center justify-between gap-4 py-1.5">
      <span className="text-gray-500 flex items-center gap-2 shrink-0"><Icon className="h-3.5 w-3.5 text-gray-400" />{label}</span>
      <span className={`font-medium text-right ${accent ?? ''}`}>{value}</span>
    </div>
  )
  const endAccent = lc.daysUntilEnd != null && lc.daysUntilEnd <= 30 ? 'text-red-600' : lc.daysUntilEnd != null && lc.daysUntilEnd <= 60 ? 'text-amber-600' : ''

  return (
    <div className="card-base space-y-1 text-sm">
      <h2 className="font-semibold text-gray-900 flex items-center gap-2 mb-2">
        <CalendarRange className="h-4 w-4 text-gray-400" />Klant Lifecycle
        {lc.batch && <span className="status-badge text-xs bg-[#fff848]/30 text-black">Batch {lc.batch}</span>}
      </h2>
      <Row Icon={Flag} label="Startdatum" value={lc.startDate ? formatDate(lc.startDate) : '—'} />
      <Row Icon={Repeat} label="Contractduur" value={lc.contractMonths ? `${lc.contractMonths} maanden` : '—'} />
      <Row Icon={CalendarClock} label="Volgende strategie review" value={lc.nextReview ? formatDate(lc.nextReview) : '—'} accent={lc.reviewThisMonth ? 'text-purple-600' : ''} />
      <Row Icon={Camera} label="Volgende shoot" value={nextShoot ? formatDate(nextShoot) : 'Nog niet gepland'} />
      <Row Icon={FileBarChart} label="Volgende rapportering" value={formatDate(nextReporting)} />
      <Row Icon={CalendarClock} label="Contractvervaldatum" value={lc.endDate ? `${formatDate(lc.endDate)}${lc.daysUntilEnd != null ? ` (${lc.daysUntilEnd}d)` : ''}` : '—'} accent={endAccent} />
    </div>
  )
}
