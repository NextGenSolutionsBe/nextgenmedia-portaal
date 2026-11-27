import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { PortalSidebar } from '@/components/portal/sidebar'
import { resolvePortalSession, sessionCan, touchLastLogin } from '@/lib/portal-auth'
import { PORTAL_MODULES } from '@/lib/portal-permissions'
import { getLang } from '@/lib/i18n-server'
import { leesKalenderRol } from '@/lib/content/kalender-beheer-server'

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  // Resolveert owner óf subaccount → clientId + rechten + actief.
  const session = await resolvePortalSession()
  if (!session) redirect('/login')
  if (!session.active) redirect('/login')

  // Alles tegelijk opvragen: na elkaar waren dat twaalf rondes naar de databank
  // vóór de pagina zelf iets kon tonen. Elke lezing blijft apart en mag mislukken
  // (bv. een kolom die vóór de migratie nog ontbreekt): dan geldt "nee".
  const admin = createAdminSupabaseClient()
  const id = session.clientId
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const veilig = async <T,>(lezing: () => PromiseLike<{ data: any; count?: number | null }>, uit: (r: { data: any; count?: number | null }) => T, terugval: T): Promise<T> => {
    try { return uit(await lezing()) } catch { return terugval }
  }
  const [, client, hasMetricool, hasCms, hasWebsitePage, hasOpleveringen, hasOffertes, activeServices, hasBlogs, kalenderRol, lang, hasSolutions] = await Promise.all([
    // Best-effort laatste-login registreren (subaccounts).
    touchLastLogin(session),
    veilig(() => admin.from('clients').select('id, company_name').eq('id', id).maybeSingle(), (r) => r.data as { id: string; company_name: string | null } | null, null),
    // Metricool-koppeling apart + best-effort (kolom kan ontbreken vóór migratie).
    veilig(() => admin.from('clients').select('metricool_blog_id').eq('id', id).maybeSingle(), (r) => !!r.data?.metricool_blog_id, false),
    // Website-CMS: enkel als cms_enabled én er een bewerkbare collectie is.
    (async () => {
      try {
        const [{ data: cl }, { count }] = await Promise.all([
          admin.from('clients').select('cms_enabled').eq('id', id).maybeSingle(),
          admin.from('cms_collections').select('id', { count: 'exact', head: true }).eq('client_id', id).eq('client_editable', true),
        ])
        return !!(cl as { cms_enabled?: boolean } | null)?.cms_enabled && (count ?? 0) > 0
      } catch { return false }
    })(),
    // Website-tab: aanpassingen aanvragen hoort bij ONDERHOUD. Zonder onderhoud
    // tonen we die tab alleen nog als er een eigen beheeromgeving is om naartoe te
    // linken — anders is de pagina leeg en verwarrend voor de klant.
    veilig(() => admin.from('clients').select('maintenance_included, website_admin_url').eq('id', id).maybeSingle(), (r) => {
      const row = r.data as { maintenance_included?: boolean | null; website_admin_url?: string | null } | null
      return !!row?.maintenance_included || !!(row?.website_admin_url ?? '').trim()
    }, false),
    // Opleveringen: enkel in het menu als er voor deze klant iets gedeeld werd.
    veilig(() => admin.from('opleveringen').select('id, oplevering_versies!inner(gepubliceerd_op)').eq('client_id', id).is('gearchiveerd_op', null).not('oplevering_versies.gepubliceerd_op', 'is', null).limit(1), (r) => (r.data ?? []).length > 0, false),
    // Offertes: enkel in het menu als er voor deze klant een offerte verstuurd werd.
    veilig(() => admin.from('offertes').select('id').eq('client_id', id).in('status', ['verstuurd', 'geaccepteerd']).limit(1), (r) => (r.data ?? []).length > 0, false),
    // Actieve diensten + blogs (gating naast rechten).
    veilig(() => admin.from('client_services').select('service_slug, active').eq('client_id', id),
      (r) => ((r.data ?? []) as { service_slug: string; active: boolean }[]).filter((s) => s.active).map((s) => s.service_slug), [] as string[]),
    veilig(() => admin.from('blog_accounts').select('id', { count: 'exact', head: true }).eq('client_id', id), (r) => (r.count ?? 0) > 0, false),
    // Een klant met rol "Geen toegang" in de contentplanning ziet de kalender ook niet in het menu.
    leesKalenderRol(admin, id).catch(() => null),
    getLang(),
    // Software en automatisatie: enkel in het menu als er een project of Care bij NextGen Solutions loopt.
    (async () => {
      const [p, c] = await Promise.all([
        veilig(() => admin.from('ngs_projecten').select('id').eq('client_id', id).is('gearchiveerd_op', null).limit(1), (r) => (r.data ?? []).length > 0, false),
        veilig(() => admin.from('ngs_care').select('id').eq('client_id', id).is('gearchiveerd_op', null).limit(1), (r) => (r.data ?? []).length > 0, false),
      ])
      return p || c
    })(),
  ])

  // Modules waarvoor deze gebruiker view-recht heeft (owner = alles).
  const kalenderDicht = kalenderRol === 'geen'
  const allowedModules = PORTAL_MODULES.filter((m) => sessionCan(session, m, 'view') && !(m === 'social_media' && kalenderDicht))

  return (
    <div className="flex min-h-screen">
      <PortalSidebar
        companyName={client?.company_name ?? 'Klantenportaal'}
        activeServices={activeServices}
        hasBlogs={hasBlogs}
        hasMetricool={hasMetricool}
        hasCms={hasCms}
        hasWebsitePage={hasWebsitePage}
        hasOpleveringen={hasOpleveringen}
        hasOffertes={hasOffertes}
        hasSolutions={hasSolutions}
        allowedModules={allowedModules}
        lang={lang}
      />
      <main className="flex-1 min-w-0 md:ml-[var(--sidebar-width)] min-h-screen overflow-x-clip">
        <div className="max-w-[1200px] mx-auto px-4 pt-20 pb-8 md:pt-6 md:px-6 lg:px-8">
          {children}
        </div>
      </main>
      <Toaster richColors position="top-right" />
    </div>
  )
}
