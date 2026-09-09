import { createAdminSupabaseClient, trySignedUrl } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PortalCalendar } from './portal-calendar'
import { ShootBriefingView, type Shoot } from '@/components/portal/shoot-briefing-view'
import { type Feedback } from '@/components/portal/shoot-feedback'
import { type Idea } from '@/components/portal/shoot-ideas'
import { requirePortalView, sessionCan } from '@/lib/portal-auth'

type FeedbackRow = Feedback & { shoot_id: string }
type IdeaRow = Idea & { shoot_id: string; attachment_path: string | null }

export default async function PortalSocialMediaPage() {
  const session = await requirePortalView('social_media')
  const clientId = session.clientId
  const canApprove = sessionCan(session, 'social_media', 'approve_scripts')
  const canFeedback = sessionCan(session, 'social_media', 'feedback')
  const admin = createAdminSupabaseClient()

  const { data: client } = await admin
    .from('clients').select('id, company_name').eq('id', clientId).maybeSingle()

  // Guard: redirect if client doesn't have social-media service
  const { data: svcRow } = await admin
    .from('client_services')
    .select('active')
    .eq('client_id', clientId)
    .eq('service_slug', 'social-media')
    .maybeSingle()
  if (!svcRow?.active) redirect('/portal')

  const { data: items } = await admin
    .from('social_content_items')
    .select('*')
    .eq('client_id', clientId)
    .order('planned_date', { ascending: true })

  // Shoot briefings. Resilient: tabel kan nog ontbreken vóór de migratie.
  const { data: shootRows } = await admin
    .from('shoot_briefings')
    .select('*')
    .eq('client_id', clientId)
    .order('shoot_date', { ascending: false, nullsFirst: false })
  const shoots = (shootRows ?? []) as Shoot[]

  const feedbackByShoot: Record<string, FeedbackRow[]> = {}
  if (shoots.length > 0) {
    const { data: fbRows } = await admin
      .from('shoot_briefing_feedback')
      .select('*')
      .in('shoot_id', shoots.map((s) => s.id))
      .order('created_at', { ascending: true })
    for (const f of (fbRows ?? []) as FeedbackRow[]) {
      ;(feedbackByShoot[f.shoot_id] ??= []).push(f)
    }
  }

  // Shoot-ideeën van de klant (+ signed urls voor bijlagen)
  const ideasByShoot: Record<string, Idea[]> = {}
  if (shoots.length > 0) {
    const { data: ideaRows } = await admin
      .from('shoot_ideas')
      .select('*')
      .in('shoot_id', shoots.map((s) => s.id))
      .order('created_at', { ascending: false })
    for (const r of (ideaRows ?? []) as IdeaRow[]) {
      const attachment_url = r.attachment_path ? await trySignedUrl(admin, 'contracts', r.attachment_path) : null
      ;(ideasByShoot[r.shoot_id] ??= []).push({ ...r, attachment_url })
    }
  }

  const pendingCount = (items ?? []).filter((i) => i.status === 'ready_for_review').length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Social Media Kalender</h1>
          <p className="text-sm text-gray-500 mt-0.5">{client?.company_name}</p>
        </div>
        {pendingCount > 0 && (
          <div className="status-badge bg-amber-100 text-amber-700 text-sm px-3 py-1.5">
            {pendingCount} wachten op goedkeuring
          </div>
        )}
      </div>

      <PortalCalendar
        initialItems={(items ?? []).map((it) => ({
          ...it,
          platforms: Array.isArray(it.platforms) ? it.platforms : it.platform ? [it.platform] : [],
        }))}
        clientId={clientId}
        canApprove={canApprove}
        canFeedback={canFeedback}
      />

      <ShootBriefingView shoots={shoots} feedbackByShoot={feedbackByShoot} ideasByShoot={ideasByShoot} />
    </div>
  )
}
