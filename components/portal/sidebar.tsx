'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useRefresh } from '@/lib/use-refresh'
import { Logo } from '@/components/logo'
import { LayoutDashboard, FileText, Calendar, Globe, LogOut, RefreshCcw, Menu, X, ListChecks, Newspaper, CalendarClock, Database, FolderUp } from 'lucide-react'
import { MODULE_IMPLEMENTED, type PortalModule } from '@/lib/portal-permissions'
import { t, type Lang } from '@/lib/i18n'
import { LangToggle } from '@/components/lang-toggle'

type NavItem = {
  tKey: string
  href: string
  icon: React.ElementType
  exact?: boolean
  requiresService?: string
  requiresBlogs?: boolean
  requiresMetricool?: boolean
  requiresCms?: boolean
  requiresWebsitePage?: boolean
  module?: string
}

const NAV: NavItem[] = [
  { tKey: 'nav.dashboard',  href: '/portal',               icon: LayoutDashboard, exact: true },
  { tKey: 'nav.contracts',  href: '/portal/contracts',     icon: FileText,  module: 'contracts' },
  { tKey: 'nav.tasks',      href: '/portal/tasks',         icon: ListChecks, module: 'tasks' },
  { tKey: 'nav.social',     href: '/portal/social-media',  icon: Calendar, requiresService: 'social-media', module: 'social_media' },
  { tKey: 'nav.metricool',  href: '/portal/metricool',     icon: CalendarClock, requiresMetricool: true, module: 'metricool' },
  { tKey: 'nav.cms',        href: '/portal/cms',           icon: Database, requiresCms: true, module: 'cms' },
  { tKey: 'nav.website',    href: '/portal/website',       icon: Globe,    requiresService: 'webdesign', requiresWebsitePage: true, module: 'website' },
  { tKey: 'nav.blogs',      href: '/portal/blogs',         icon: Newspaper, requiresBlogs: true, module: 'blogs' },
  // Aanleveren van beeldmateriaal. Bewust GEEN requiresService: ook een klant
  // zonder lopend socialmediapakket moet ons foto's kunnen doorsturen.
  { tKey: 'nav.files',      href: '/portal/bestanden',     icon: FolderUp, module: 'files' },
]

export function PortalSidebar({
  companyName,
  activeServices = [],
  hasBlogs = false,
  hasMetricool = false,
  hasCms = false,
  hasWebsitePage = false,
  allowedModules,
  lang = 'nl',
}: {
  companyName: string
  activeServices?: string[]
  hasBlogs?: boolean
  hasMetricool?: boolean
  hasCms?: boolean
  /** Website-tab enkel bij onderhoud of een eigen beheeromgeving. */
  hasWebsitePage?: boolean
  /** Modules met view-recht. Undefined = alles tonen (owner/backward compat). */
  allowedModules?: string[]
  lang?: Lang
}) {
  const pathname = usePathname()
  const router = useRouter()
  const { refresh, spinning } = useRefresh()
  const [mobileOpen, setMobileOpen] = useState(false)

  const handleLogout = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const closeMobile = () => setMobileOpen(false)

  const visibleNav = NAV.filter(
    (item) =>
      (!item.module || MODULE_IMPLEMENTED[item.module as PortalModule]) &&
      (!item.requiresService || activeServices.includes(item.requiresService)) &&
      (!item.requiresBlogs || hasBlogs) &&
      (!item.requiresMetricool || hasMetricool) &&
      (!item.requiresCms || hasCms) &&
      (!item.requiresWebsitePage || hasWebsitePage) &&
      (!item.module || !allowedModules || allowedModules.includes(item.module))
  )

  return (
    <>
      {/* ── Mobile hamburger button ── */}
      <button
        className="md:hidden fixed top-3 left-3 z-50 h-10 w-10 flex items-center justify-center rounded-xl bg-white border border-gray-200 shadow-sm"
        onClick={() => setMobileOpen(true)}
        aria-label="Menu openen"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* ── Backdrop ── */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 backdrop-blur-sm z-40"
          onClick={closeMobile}
        />
      )}

      {/* ── Sidebar panel ── */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-screen w-[var(--sidebar-width)] bg-white border-r border-gray-200 flex flex-col z-40',
          'transition-transform duration-300 ease-in-out',
          'md:translate-x-0',
          mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full',
        )}
      >
        <div className="px-4 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <Logo className="h-8 w-8 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-black leading-tight truncate">{companyName}</div>
              <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">{t(lang, 'portal.subtitle')}</div>
            </div>
            {/* Refresh */}
            <button
              onClick={refresh}
              disabled={spinning}
              title={t(lang, 'common.refresh')}
              className="h-7 w-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              <RefreshCcw className={cn('h-3.5 w-3.5', spinning && 'animate-spin')} />
            </button>
            {/* Close (mobile) */}
            <button
              onClick={closeMobile}
              className="md:hidden h-7 w-7 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100"
              aria-label="Menu sluiten"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-0.5">
          {visibleNav.map((item) => {
            const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMobile}
                className={cn('sidebar-item', isActive && 'active')}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {t(lang, item.tKey)}
              </Link>
            )
          })}
        </nav>

        <div className="px-3 py-4 border-t border-gray-100 space-y-3">
          {/* Taalwissel NL / EN */}
          <div className="flex items-center justify-between px-1">
            <span className="text-[11px] text-gray-400">{t(lang, 'common.language')}</span>
            <LangToggle current={lang} />
          </div>
          <button
            onClick={handleLogout}
            className="sidebar-item w-full text-red-500 hover:text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" />
            {t(lang, 'common.logout')}
          </button>
        </div>
      </aside>
    </>
  )
}
