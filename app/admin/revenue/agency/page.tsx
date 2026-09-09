export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { SERVICE_LABELS } from '@/lib/utils'
import { Users, Calendar, Camera, FileText, Globe, Wrench, UserSquare2, ArrowLeftRight, Briefcase } from 'lucide-react'
import { Kpi, SectionTitle } from '../kpi'

const cnt = (n: number | null | undefined) => String(n ?? 0)

export default async function AgencyPage() {
  const admin = createAdminSupabaseClient()
  const startMonth = new Date(); startMonth.setDate(1); startMonth.setHours(0, 0, 0, 0)
  const todayISO = new Date().toISOString().slice(0, 10)

  const [
    activeClients, newClients, svcRows,
    shoots, openScripts, openFeedback,
    openWebReq, activePartners, openSettlements, openAssignments,
  ] = await Promise.all([
    admin.from('clients').select('id', { count: 'exact', head: true }).is('archived_at', null),
    admin.from('clients').select('id', { count: 'exact', head: true }).is('archived_at', null).gte('created_at', startMonth.toISOString()),
    admin.from('client_services').select('service_slug').eq('active', true),
    admin.from('shoot_briefings').select('id', { count: 'exact', head: true }).gte('shoot_date', todayISO),
    admin.from('social_content_items').select('id', { count: 'exact', head: true }).eq('status', 'ready_for_review'),
    admin.from('social_content_items').select('id', { count: 'exact', head: true }).eq('status', 'changes_requested'),
    admin.from('webdesign_change_requests').select('id', { count: 'exact', head: true }).in('status', ['new', 'in_review']),
    admin.from('freelancers').select('id', { count: 'exact', head: true }).eq('active', true),
    admin.from('partner_settlements').select('id', { count: 'exact', head: true }).neq('status', 'paid'),
    admin.from('freelancer_assignments').select('id', { count: 'exact', head: true }).in('status', ['open', 'in_progress']),
  ])

  const perService: Record<string, number> = {}
  for (const r of (svcRows.data ?? []) as { service_slug: string }[]) perService[r.service_slug] = (perService[r.service_slug] ?? 0) + 1
  const socialActive = perService['social-media'] ?? 0
  const webActive = perService['webdesign'] ?? 0

  return (
    <div className="space-y-6">
      <div>
        <SectionTitle>Klanten</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <Kpi label="Actieve klanten" value={cnt(activeClients.count)} Icon={Users} />
          <Kpi label="Nieuw deze maand" value={cnt(newClients.count)} color="text-green-600" Icon={Users} />
          <Kpi label="Diensten actief" value={cnt(Object.values(perService).reduce((s, v) => s + v, 0))} Icon={Briefcase} />
        </div>
        {Object.keys(perService).length > 0 && (
          <div className="card-base mt-4">
            <h3 className="text-sm font-semibold mb-3">Klanten per dienst</h3>
            <div className="flex flex-wrap gap-2">
              {Object.entries(perService).sort(([, a], [, b]) => b - a).map(([slug, n]) => (
                <span key={slug} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-gray-200 text-xs">
                  <span className="font-bold">{n}</span> {SERVICE_LABELS[slug] ?? slug}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      <div>
        <SectionTitle>Social Media</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <Kpi label="Actieve contentklanten" value={cnt(socialActive)} Icon={Calendar} />
          <Kpi label="Geplande shoots" value={cnt(shoots.count)} color="text-purple-600" Icon={Camera} />
          <Kpi label="Open scripts" value={cnt(openScripts.count)} color="text-amber-600" Icon={FileText} />
          <Kpi label="Open feedbackrondes" value={cnt(openFeedback.count)} color="text-red-600" Icon={FileText} />
        </div>
      </div>

      <div>
        <SectionTitle>Websites</SectionTitle>
        <div className="grid grid-cols-2 gap-4">
          <Kpi label="Actieve onderhoudscontracten" value={cnt(webActive)} Icon={Globe} />
          <Kpi label="Open onderhoudsaanvragen" value={cnt(openWebReq.count)} color="text-amber-600" Icon={Wrench} />
        </div>
      </div>

      <div>
        <SectionTitle>Partners</SectionTitle>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          <Kpi label="Actieve partners" value={cnt(activePartners.count)} Icon={UserSquare2} />
          <Kpi label="Open settlements" value={cnt(openSettlements.count)} color="text-amber-600" Icon={ArrowLeftRight} />
          <Kpi label="Open opdrachten" value={cnt(openAssignments.count)} color="text-blue-600" Icon={Briefcase} />
        </div>
      </div>
    </div>
  )
}
