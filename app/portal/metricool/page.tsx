export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalView } from '@/lib/portal-auth'
import { geldigeMetricoolFeedbackUrl } from '@/lib/metricool-feedback'
import { PortalMetricool } from './portal-metricool'

export default async function PortalMetricoolPage() {
  const session = await requirePortalView('metricool')

  // Enkel zichtbaar als deze klant aan een Metricool-merk gekoppeld is.
  const admin = createAdminSupabaseClient()
  const { data: client } = await admin
    .from('clients').select('company_name, metricool_blog_id').eq('id', session.clientId).maybeSingle()
  if (!client?.metricool_blog_id) redirect('/portal')

  // Feedbacklink: apart en best-effort (kolom kan ontbreken vóór migratie),
  // altijd gekeyd op de geresolveerde clientId en server-side gevalideerd.
  let feedbackUrl: string | null = null
  try {
    const { data: fb } = await admin
      .from('clients').select('metricool_feedback_url').eq('id', session.clientId).maybeSingle()
    feedbackUrl = geldigeMetricoolFeedbackUrl((fb as { metricool_feedback_url?: string | null } | null)?.metricool_feedback_url)
  } catch { feedbackUrl = null }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Metricool-planning</h1>
        <p className="text-sm text-gray-500 mt-0.5">Bekijk wanneer je posts online komen — met preview. Plannen en goedkeuren gebeurt via Metricool.</p>
      </div>
      <PortalMetricool feedbackUrl={feedbackUrl} />
    </div>
  )
}
