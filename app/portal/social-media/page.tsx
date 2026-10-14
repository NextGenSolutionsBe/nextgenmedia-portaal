import { createAdminSupabaseClient, trySignedUrl } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PortalCalendar } from './portal-calendar'
import { ShootBriefingView, type Shoot } from '@/components/portal/shoot-briefing-view'
import { type Feedback } from '@/components/portal/shoot-feedback'
import { type Idea } from '@/components/portal/shoot-ideas'
import { requirePortalView } from '@/lib/portal-auth'
import { kalenderRechtenVoorSessie } from '@/lib/content/kalender-beheer-server'
import { ROL_INFO, kanGoedkeuren } from '@/lib/content/kalender-rol'
import { ShootDocumentKnop } from '@/components/shoot-document-knop'
import { getLang } from '@/lib/i18n-server'
import { goedkeuringenVoorKlant } from '@/lib/content/goedkeuring-deadlines'

type FeedbackRow = Feedback & { shoot_id: string }
type IdeaRow = Idea & { shoot_id: string; attachment_path: string | null }

export default async function PortalSocialMediaPage({ searchParams }: { searchParams?: { item?: string } }) {
  const session = await requirePortalView('social_media')
  const clientId = session.clientId
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
  // Wat deze gebruiker mag: de rol van de klant in de contentplanning × eigen portaalrechten.
  // "Geen toegang" opent de kalender niet (ook de API's weigeren).
  const rechten = await kalenderRechtenVoorSessie(admin, session)
  if (!rechten.bekijken) redirect('/portal')
  const magGoedkeuren = kanGoedkeuren(rechten)

  // Wat op goedkeuring wacht (met aftelling): enkel tonen aan wie ook kan goedkeuren.
  const lang = await getLang()
  const goedkeuringen = magGoedkeuren ? await goedkeuringenVoorKlant(admin, clientId) : []
  // ?item=<id> (vanuit het dashboard of de mail): dat item meteen openen, als het van deze klant is.
  const openItem = /^[0-9a-f-]{36}$/i.test(searchParams?.item ?? '') ? searchParams!.item! : null

  const { data: items } = await admin
    .from('social_content_items')
    // Expliciete kolommen: geen interne velden (ClickUp, aanmaker, contract) naar de klant.
    .select('id, client_id, planned_date, planned_time, platform, platforms, content_type, title, caption, script, media_notes, status, client_feedback, reviewed_at, created_at, klant_aangemaakt_op, published_at, published_url, published_platform')
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Social Media Kalender</h1>
          <p className="text-sm text-gray-500 mt-0.5">{client?.company_name}</p>
          {ROL_INFO[rechten.rol].klant && <p className="text-xs text-gray-500 mt-1">{ROL_INFO[rechten.rol].klant}</p>}
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-2">
          {pendingCount > 0 && magGoedkeuren && (
            <div className="status-badge bg-amber-100 text-amber-700 text-sm px-3 py-1.5 self-start sm:self-auto">
              {pendingCount} wachten op goedkeuring
            </div>
          )}
          <ShootDocumentKnop
            href="/api/portal/social-media/shoot-document"
            label="Shootdocument downloaden"
            className="w-full sm:w-auto justify-center"
            title="Print-klare checklist voor de eerstvolgende shoot (scripts + medianotities)"
          />
        </div>
      </div>


      <PortalCalendar
        initialItems={(items ?? []).map((it) => ({
          ...it,
          platforms: Array.isArray(it.platforms) ? it.platforms : it.platform ? [it.platform] : [],
        }))}
        clientId={clientId}
        rechten={rechten}
        goedkeuringen={goedkeuringen}
        lang={lang}
        openItem={openItem}
      />

      <ShootBriefingView shoots={shoots} feedbackByShoot={feedbackByShoot} ideasByShoot={ideasByShoot} />
    </div>
  )
}
