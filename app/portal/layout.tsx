import { redirect } from 'next/navigation'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { PortalSidebar } from '@/components/portal/sidebar'
import { resolvePortalSession, sessionCan, touchLastLogin } from '@/lib/portal-auth'
import { PORTAL_MODULES } from '@/lib/portal-permissions'
import { getLang } from '@/lib/i18n-server'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // Resolveert owner óf subaccount → clientId + rechten + actief.
  const session = await resolvePortalSession()
  if (!session) redirect('/login')
  if (!session.active) redirect('/login')

  // Best-effort laatste-login registreren (subaccounts).
  await touchLastLogin(session)

  const admin = createAdminSupabaseClient()
  const { data: client } = await admin
    .from('clients').select('id, company_name').eq('id', session.clientId).maybeSingle()

  // Metricool-koppeling apart + best-effort (kolom kan ontbreken vóór migratie).
  let hasMetricool = false
  try {
    const { data: mc } = await admin
      .from('clients').select('metricool_blog_id').eq('id', session.clientId).maybeSingle()
    hasMetricool = !!(mc as { metricool_blog_id?: string | null } | null)?.metricool_blog_id
  } catch { hasMetricool = false }

  // Website-CMS: enkel als cms_enabled én er een bewerkbare collectie is.
  let hasCms = false
  try {
    const { data: cl } = await admin.from('clients').select('cms_enabled').eq('id', session.clientId).maybeSingle()
    if ((cl as { cms_enabled?: boolean } | null)?.cms_enabled) {
      const { count } = await admin.from('cms_collections')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', session.clientId).eq('client_editable', true)
      hasCms = (count ?? 0) > 0
    }
  } catch { hasCms = false }

  // Website-tab: aanpassingen aanvragen hoort bij ONDERHOUD. Zonder onderhoud
  // tonen we die tab alleen nog als er een eigen beheeromgeving is om naartoe te
  // linken — anders is de pagina leeg en verwarrend voor de klant.
  let hasWebsitePage = false
  try {
    const { data: w } = await admin
      .from('clients').select('maintenance_included, website_admin_url').eq('id', session.clientId).maybeSingle()
    const row = w as { maintenance_included?: boolean | null; website_admin_url?: string | null } | null
    hasWebsitePage = !!row?.maintenance_included || !!(row?.website_admin_url ?? '').trim()
  } catch { hasWebsitePage = false }

  // Actieve diensten + blogs (gating naast rechten).
  let activeServices: string[] = []
  let hasBlogs = false
  const { data: svcRows } = await admin
    .from('client_services').select('service_slug, active').eq('client_id', session.clientId)
  activeServices = (svcRows ?? []).filter((s: { active: boolean }) => s.active).map((s: { service_slug: string }) => s.service_slug)
  const { count: blogAccCount } = await admin
    .from('blog_accounts').select('id', { count: 'exact', head: true }).eq('client_id', session.clientId)
  hasBlogs = (blogAccCount ?? 0) > 0

  // Modules waarvoor deze gebruiker view-recht heeft (owner = alles).
  const allowedModules = PORTAL_MODULES.filter((m) => sessionCan(session, m, 'view'))
  const lang = await getLang()

  return (
    <div className="flex min-h-screen bg-gray-50">
      <PortalSidebar
        companyName={client?.company_name ?? 'Klantenportaal'}
        activeServices={activeServices}
        hasBlogs={hasBlogs}
        hasMetricool={hasMetricool}
        hasCms={hasCms}
        hasWebsitePage={hasWebsitePage}
        allowedModules={allowedModules}
        lang={lang}
      />
      <main className="flex-1 min-w-0 md:ml-[var(--sidebar-width)] min-h-screen">
        <div className="max-w-[1200px] mx-auto px-4 pt-20 pb-8 md:pt-6 md:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  )
}
