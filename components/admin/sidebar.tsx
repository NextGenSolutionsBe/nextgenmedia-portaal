'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, FileText, UserSquare2, ArrowLeftRight, TrendingUp,
  LogOut, ChevronDown, Globe, Calendar, Briefcase, RefreshCcw, Menu, X,
  Info, ClipboardList, CalendarDays, ShoppingCart, Mail, Receipt, Newspaper, Rocket, UserCog, CalendarClock, BarChart3, KanbanSquare,
  MailCheck, PhoneCall, Stamp, FolderUp,
} from 'lucide-react'
import { canSeeModule } from '@/lib/staff'
import { DISABLED_MODULE_KEYS } from '@/lib/features'
import { useState } from 'react'
import { useRefresh } from '@/lib/use-refresh'
import { Logo } from '@/components/logo'

type NavChild = { label: string; href: string; icon: React.ElementType; exact?: boolean }
type NavEntry = {
  label: string
  href: string
  icon: React.ElementType
  exact?: boolean
  module?: string
  adminOnly?: boolean
  children?: NavChild[]
}
type NavSection = { title?: string; items: NavEntry[] }

// Gegroepeerd per thema zodat de zijbalk overzichtelijk blijft. Volgorde binnen
// een sectie = werkvolgorde. Gating (module/adminOnly) blijft per item behouden.
const SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Command Center', href: '/admin', icon: LayoutDashboard, exact: true },
    ],
  },
  {
    title: 'Klanten & content',
    items: [
      { label: 'Klanten',    href: '/admin/clients',   icon: Users, module: 'clients' },
      { label: 'Contracten', href: '/admin/contracts', icon: FileText, module: 'contracts' },
      {
        label: 'Diensten', href: '/admin/services', icon: Briefcase, module: 'content',
        children: [
          { label: 'Social Media', href: '/admin/services/social-media', icon: Calendar },
          { label: 'Website',      href: '/admin/services/website',      icon: Globe },
        ],
      },
      {
        label: 'Metricool', href: '/admin/metricool', icon: CalendarClock, module: 'metricool',
        children: [
          { label: 'Kalender',     href: '/admin/metricool',       icon: CalendarClock, exact: true },
          { label: 'Statistieken', href: '/admin/metricool/stats', icon: BarChart3 },
        ],
      },
      {
        label: 'Blogs', href: '/admin/blog-calendar', icon: Newspaper, module: 'blogs',
        children: [
          { label: 'Projecten', href: '/admin/blogaccounts',  icon: Newspaper },
          { label: 'Kalender',  href: '/admin/blog-calendar', icon: CalendarDays },
        ],
      },
      // Eigen ingang, geen tabblad onder Social Media: materiaal komt binnen
      // los van de kalender en je wil in één lijst zien wat er nieuw is.
      { label: 'Klantuploads', href: '/admin/uploads', icon: FolderUp, module: 'uploads' },
    ],
  },
  {
    title: 'Partners',
    items: [
      { label: 'Partners',    href: '/admin/partners',    icon: UserSquare2, module: 'partners' },
      { label: 'Opdrachten',  href: '/admin/assignments', icon: Briefcase, module: 'assignments' },
      { label: 'Settlements', href: '/admin/settlements', icon: ArrowLeftRight, module: 'settlements' },
    ],
  },
  {
    title: 'Verkoop',
    items: [
      { label: 'Appointment setting', href: '/admin/sales/appointments', icon: CalendarClock, module: 'sales' },
      { label: 'Pipeline',            href: '/admin/sales/pipeline',     icon: KanbanSquare, module: 'sales' },
      { label: 'Bevestigingen',       href: '/admin/sales/herinneringen', icon: PhoneCall,   module: 'sales' },
      { label: 'Resultaten',          href: '/admin/sales/resultaten',   icon: BarChart3,    module: 'sales' },
    ],
  },
  {
    title: 'Aanbestedingen',
    items: [
      { label: 'Aanbestedingen', href: '/admin/aanbestedingen', icon: Stamp, module: 'aanbestedingen' },
    ],
  },
  {
    title: 'Financieel',
    items: [
      { label: 'Financiën', href: '/admin/revenue/omzet', icon: TrendingUp, module: 'finance' },
      { label: 'Facturen', href: '/admin/invoices',      icon: Receipt, module: 'invoices' },
      { label: 'Vesting',  href: '/admin/vesting',       icon: Rocket, module: 'vesting' },
      { label: 'Aankopen', href: '/admin/purchases',     icon: ShoppingCart, module: 'purchases' },
    ],
  },
  {
    title: 'Overig',
    items: [
      { label: 'E-mailcenter', href: '/admin/email', icon: Mail, module: 'email' },
      {
        label: 'Informatief', href: '/admin/informatief', icon: Info, module: 'info',
        children: [
          { label: 'Onboarding Info', href: '/admin/onboarding',   icon: ClipboardList },
          { label: 'Maandplanning',   href: '/admin/maandplanning', icon: CalendarDays },
        ],
      },
    ],
  },
  {
    title: 'Beheer',
    items: [
      { label: 'Werknemers', href: '/admin/werknemers', icon: UserCog, adminOnly: true },
    ],
  },
]

function NavItem({
  item,
  onNavigate,
}: {
  item: NavEntry
  onNavigate: () => void
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(() =>
    item.children?.some((c) => pathname.startsWith(c.href)) || pathname.startsWith(item.href)
  )
  const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href)
  const Icon = item.icon

  if (item.children) {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className={cn('sidebar-item w-full justify-between', isActive && 'active')}
        >
          <span className="flex items-center gap-3">
            <Icon className="h-4 w-4 shrink-0" />
            {item.label}
          </span>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', open && 'rotate-180')} />
        </button>
        {open && (
          <div className="ml-4 mt-1 space-y-0.5 border-l border-gray-100 pl-3">
            {item.children.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                onClick={onNavigate}
                className={cn('sidebar-item text-xs', (child.exact ? pathname === child.href : pathname.startsWith(child.href)) && 'active')}
              >
                <child.icon className="h-3.5 w-3.5 shrink-0" />
                {child.label}
              </Link>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={cn('sidebar-item', isActive && 'active')}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {item.label}
    </Link>
  )
}

export function AdminSidebar({ allowedModules, isEmployee = false }: { allowedModules?: string[]; isEmployee?: boolean } = {}) {
  const router = useRouter()
  const { refresh, spinning } = useRefresh()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Werknemer ziet enkel toegestane modules; admin (allowedModules undefined) ziet alles.
  const canSee = (item: NavEntry) => {
    // Uitgeschakelde features (lib/features.ts) tonen we voor niemand — ook niet
    // voor admin; de middleware blokkeert die paden sowieso.
    if (item.module && DISABLED_MODULE_KEYS.includes(item.module)) return false
    if (item.adminOnly && isEmployee) return false
    if (!item.module || !allowedModules) return true
    return canSeeModule(allowedModules, item.module)
  }
  const visibleSections = SECTIONS
    .map((s) => ({ title: s.title, items: s.items.filter(canSee) }))
    .filter((s) => s.items.length > 0)

  const handleLogout = async () => {
    const supabase = createClient()
    // Ook de verificatie-cookie wissen, zodat opnieuw inloggen weer een code vraagt.
    try { await fetch('/api/auth/2fa/logout', { method: 'POST' }) } catch { }
    await supabase.auth.signOut()
    router.replace('/login')
  }

  const closeMobile = () => setMobileOpen(false)

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
        {/* Logo + close */}
        <div className="px-4 py-5 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <Logo className="h-8 w-8 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-black leading-tight">NextGenMedia</div>
              <div className="text-[10px] text-gray-400 font-medium uppercase tracking-wider">Admin</div>
            </div>
            {/* Refresh */}
            <button
              onClick={refresh}
              disabled={spinning}
              title="Pagina vernieuwen"
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

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {visibleSections.map((section, si) => (
            <div key={section.title ?? `sec-${si}`} className={si > 0 ? 'mt-4' : ''}>
              {section.title && (
                <div className="px-3 mb-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                  {section.title}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavItem key={item.href} item={item} onNavigate={closeMobile} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Logout */}
        <div className="px-3 py-4 border-t border-gray-100">
          <button
            onClick={handleLogout}
            className="sidebar-item w-full text-red-500 hover:text-red-600 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Uitloggen
          </button>
        </div>
      </aside>
    </>
  )
}
