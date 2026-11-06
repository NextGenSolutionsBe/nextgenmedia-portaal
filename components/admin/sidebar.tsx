'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard, Users, FileText, UserSquare2, ArrowLeftRight, TrendingUp,
  LogOut, ChevronDown, Globe, Calendar, Briefcase, RefreshCcw, Menu, X,
  Info, Camera, ClipboardList, CalendarDays, ShoppingCart, Mail, Receipt, Newspaper, Rocket, CalendarClock, BarChart3, KanbanSquare,
  MailCheck, FolderUp, Handshake, Settings, ClipboardPen, Contact, Timer, UserCircle, Video, Inbox, Clapperboard, Film, Building2, FileSignature,
} from 'lucide-react'
import { canSeeModule } from '@/lib/staff'
import { DISABLED_MODULE_KEYS } from '@/lib/features'
import { OpslagMeter } from './opslag-meter'
import { moduleBeschikbaar, MODULE_DASHBOARD_KEY, type AlleInstellingen, type Rol } from '@/lib/instellingen/model'
import { useEffect, useState } from 'react'
import { useRefresh } from '@/lib/use-refresh'
import { Logo } from '@/components/logo'

type NavChild = { label: string; href: string; icon: React.ElementType; exact?: boolean }
type NavEntry = {
  label: string
  href: string
  icon: React.ElementType
  exact?: boolean
  module?: string
  /** Tweede module die het item ook zichtbaar maakt (gedeelde pagina, zie lib/staff.ts). */
  ookModule?: string
  adminOnly?: boolean
  children?: NavChild[]
  /** Sleutel uit /api/admin/badges: toont een rood telbolletje. */
  badge?: string
}
type NavSection = { title?: string; items: NavEntry[] }

// Gegroepeerd per thema zodat de zijbalk overzichtelijk blijft. Volgorde binnen
// een sectie = werkvolgorde. Gating (module/adminOnly) blijft per item behouden.
const SECTIONS: NavSection[] = [
  {
    items: [
      { label: 'Command Center', href: '/admin', icon: LayoutDashboard, exact: true },
      { label: 'Dagelijkse planning Chiara', href: '/admin/contentplanning', icon: CalendarDays, module: 'info' },
    ],
  },
  {
    // Van eerste contact tot getekend: wie zijn onze klanten en wat loopt er.
    title: 'Klanten & projecten',
    items: [
      { label: 'Klanten',     href: '/admin/clients',    icon: Users, module: 'clients' },
      // Eén overzicht voor leads en projecten (vervangt de vroegere pipeline).
      { label: 'Projecten',   href: '/admin/opdrachten', icon: KanbanSquare, module: 'opdrachten' },
      { label: 'Contracten',  href: '/admin/contracts',  icon: FileText, module: 'contracts' },
      { label: 'Offertes',    href: '/admin/offertes',   icon: FileSignature, module: 'offertes' },
      { label: 'Aanvragen',   href: '/admin/aanvragen',  icon: Inbox, module: 'aanvragen' },
      { label: 'Meeting Inplanner', href: '/admin/meetings', icon: Video, module: 'meetings', ookModule: 'sales' },
    ],
  },
  {
    // Het werk zelf: plannen, maken en opleveren.
    title: 'Uitvoering',
    items: [
      // De contentkalenders per klant (ingeplande posts, feedback van de klant).
      { label: 'Social media', href: '/admin/services/social-media', icon: Calendar, module: 'content' },
      { label: 'Metricool', href: '/admin/metricool', icon: CalendarClock, module: 'metricool', exact: true },
      { label: 'Video-opleveringen', href: '/admin/opleveringen', icon: Film, module: 'opleveringen' },
      // Enkel nog onderhoud: wanneer start en loopt elk onderhoudscontract af.
      { label: 'Website-onderhoud', href: '/admin/services/website', icon: Globe, module: 'content' },
      {
        label: 'Blogs', href: '/admin/blog-calendar', icon: Newspaper, module: 'blogs',
        children: [
          { label: 'Projecten', href: '/admin/blogaccounts',  icon: Newspaper },
          { label: 'Kalender',  href: '/admin/blog-calendar', icon: CalendarDays },
        ],
      },
      { label: 'Klantuploads', href: '/admin/uploads', icon: FolderUp, module: 'uploads' },
      { label: 'Formulieren', href: '/admin/formulieren', icon: ClipboardPen, module: 'formulieren' },
      { label: 'Materiaalbeheer', href: '/admin/materiaal', icon: Camera, module: 'materiaal' },
    ],
  },
  {
    // Wat klanten in hun app te zien krijgen.
    title: 'Klantapp',
    items: [
      { label: 'Founders of Flanders', href: '/admin/founders-of-flanders', icon: Clapperboard, module: 'founders' },
      { label: 'Onze partners', href: '/admin/onze-partners', icon: Handshake, module: 'onze_partners' },
    ],
  },
  {
    title: 'Financieel',
    items: [
      { label: 'Financiën', href: '/admin/revenue/omzet', icon: TrendingUp, module: 'finance' },
      { label: 'Omzetrapportage', href: '/admin/revenue/rapportage', icon: BarChart3, module: 'finance' },
      { label: 'Facturen', href: '/admin/invoices',      icon: Receipt, module: 'invoices' },
      { label: 'Aankopen', href: '/admin/purchases',     icon: ShoppingCart, module: 'purchases' },
      { label: 'Vesting',  href: '/admin/vesting',       icon: Rocket, module: 'vesting' },
    ],
  },
  {
    title: 'Team & partners',
    items: [
      // Personeel = iedereen die voor ons werkt: dossiers, planning, uren, kosten
      // en (voor hoofdbeheerders) de logins met rollen en modules.
      { label: 'Personeel', href: '/admin/personeel', icon: Contact, module: 'personeel', adminOnly: true },
      { label: 'Kantoor', href: '/admin/kantoor', icon: Building2, module: 'kantoor' },
      { label: 'Partners',    href: '/admin/partners',    icon: UserSquare2, module: 'partners' },
      { label: 'Opdrachten partners', href: '/admin/assignments', icon: Briefcase, module: 'assignments' },
      { label: 'Settlements', href: '/admin/settlements', icon: ArrowLeftRight, module: 'settlements' },
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
        ],
      },
    ],
  },
]

function NavItem({
  item,
  onNavigate,
  badge = 0,
}: {
  item: NavEntry
  onNavigate: () => void
  /** Aantal voor het rode bolletje; 0 = niets tonen. */
  badge?: number
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
          <div className="ml-4 mt-1 space-y-0.5 border-l border-white/10 pl-3">
            {item.children.map((child) => (
              <Link
                key={child.href}
                href={child.href}
                prefetch={false}
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
    // prefetch={false} — ZONDER dit haalde de browser bij elke adminpagina
    // ALLE 34 menu-items vooruit op. Elke adminpagina is force-dynamic en er is
    // geen loading.tsx, dus zo'n vooruitgehaalde pagina wordt VOLLEDIG op de
    // server gerenderd, mét al zijn databasequery's. Eén keer inloggen zette
    // daardoor ~25 volledige paginarenders tegelijk in gang — genoeg om op het
    // gratis Supabase-plan de middleware te laten vastlopen (MIDDLEWARE_-
    // INVOCATION_TIMEOUT, en dan is de hele app onbereikbaar).
    <Link
      href={item.href}
      prefetch={false}
      onClick={onNavigate}
      className={cn('sidebar-item', isActive && 'active')}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1">{item.label}</span>
      {/* Rood telbolletje: iets is te laat en vraagt aandacht. */}
      {badge > 0 && (
        <span
          title={`${badge} ${badge === 1 ? 'opdracht is' : 'opdrachten zijn'} te laat`}
          className="ml-auto min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </Link>
  )
}

export function AdminSidebar({ allowedModules, isEmployee = false, naam, email, fotoVersie = null, instellingen, rol = 'hoofdbeheerder', verborgenPersoonlijk = [], toonInstellingen = false, mijnWerk = false }: {
  allowedModules?: string[]
  isEmployee?: boolean
  /** Voornaam van wie er ingelogd is — voor de begroeting bovenaan. */
  naam?: string
  /** Het e-mailadres eronder: het harde antwoord op "welk account is dit?". */
  email?: string
  /** Eigen profielfoto (Mijn account); null = initiaal. */
  fotoVersie?: string | null
  /** Centrale instellingen (globale zichtbaarheid + toegang per rol). Zonder = alles zoals vroeger. */
  instellingen?: AlleInstellingen
  rol?: Rol
  /** Tabbladen die deze gebruiker enkel voor zichzelf verborg. */
  verborgenPersoonlijk?: string[]
  /** Knop "Instellingen" onderaan tonen (hoofdbeheerder, of beheerder met dat recht). */
  toonInstellingen?: boolean
  /** Heeft deze login een personeelsdossier? Dan staat "Mijn werk" (inklokken, planning) bovenaan. */
  mijnWerk?: boolean
} = {}) {
  const router = useRouter()
  const { refresh, spinning } = useRefresh()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [fotoKapot, setFotoKapot] = useState(false)
  useEffect(() => { setFotoKapot(false) }, [fotoVersie])
  // Telbolletjes. Los van de rest opgehaald: haperen ze, dan staat het menu er
  // gewoon zonder — een bolletje is nooit de reden om navigatie op te houden.
  const [badges, setBadges] = useState<Record<string, number>>({})
  useEffect(() => {
    let levend = true
    fetch('/api/admin/badges')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (levend && j) setBadges(j) })
      .catch(() => { /* stil */ })
    return () => { levend = false }
  }, [])

  // Werknemer ziet enkel toegestane modules; admin (allowedModules undefined) ziet alles.
  const padNu = usePathname() ?? ''
  const canSee = (item: NavEntry): boolean => {
    if (item.ookModule) return canSee({ ...item, ookModule: undefined }) || canSee({ ...item, module: item.ookModule, ookModule: undefined })
    // Uitgeschakelde features (lib/features.ts) tonen we voor niemand — ook niet
    // voor admin; de middleware blokkeert die paden sowieso.
    if (item.module && DISABLED_MODULE_KEYS.includes(item.module)) return false
    if (item.adminOnly && isEmployee) return false
    // Centrale instellingen: globaal verborgen wint van alles; daarna toegang
    // per rol; daarna de persoonlijke keuze van de gebruiker zelf.
    const sleutel = item.module ?? (item.href === '/admin' ? MODULE_DASHBOARD_KEY : item.href === '/admin/werknemers' ? 'werknemers' : null)
    if (instellingen && sleutel && !moduleBeschikbaar(instellingen, { rol, modules: allowedModules ?? null }, sleutel)) return false
    if (sleutel && verborgenPersoonlijk.includes(sleutel)) return false
    if (!item.module || !allowedModules) return true
    return canSeeModule(allowedModules, item.module)
  }
  // Volgorde uit Instellingen → Tabbladen (standaard = de volgorde hieronder).
  const volgordeVan = (item: NavEntry): number => {
    const k = item.module ?? (item.href === '/admin' ? MODULE_DASHBOARD_KEY : item.href === '/admin/werknemers' ? 'werknemers' : null)
    const v = k ? instellingen?.modules[k]?.volgorde : undefined
    return typeof v === 'number' ? v : Number.MAX_SAFE_INTEGER
  }
  const visibleSections = SECTIONS
    .map((s) => ({
      title: s.title,
      items: s.items.filter(canSee).map((it, i) => [it, i] as const).sort((a, b) => (volgordeVan(a[0]) - volgordeVan(b[0])) || (a[1] - b[1])).map(([it]) => it),
    }))
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
      {/* ── Gsm, werknemers (zonder bovenbalk): vaste balk achter de menuknop ── */}
      {isEmployee && <div className="md:hidden fixed top-0 inset-x-0 z-30 h-[60px] bg-white/95 backdrop-blur border-b border-gray-200" />}

      {/* ── Mobile hamburger button ── */}
      <button
        className={cn('md:hidden fixed top-2.5 left-3 z-50 h-10 w-10 flex items-center justify-center rounded-md bg-white border border-gray-200 text-gray-900', mobileOpen && 'hidden')}
        onClick={() => setMobileOpen(true)}
        aria-label="Menu openen"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* ── Backdrop ── */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40"
          onClick={closeMobile}
        />
      )}

      {/* ── Sidebar panel ── */}
      <aside
        className={cn(
          'fixed left-0 top-0 h-screen w-[var(--sidebar-width)] bg-gray-900 text-gray-300 flex flex-col z-40',
          'transition-transform duration-300 ease-in-out',
          'md:translate-x-0',
          mobileOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full',
        )}
      >
        {/* Logo + close */}
        <div className="px-4 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <Logo className="h-8 w-8 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white leading-tight">NextGenMedia</div>
              <div className="text-[11px] text-gray-400">Admin</div>
            </div>
            {/* Refresh */}
            <button
              onClick={refresh}
              disabled={spinning}
              title="Pagina vernieuwen"
              className="h-7 w-7 flex items-center justify-center rounded-md text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
            >
              <RefreshCcw className={cn('h-3.5 w-3.5', spinning && 'animate-spin')} />
            </button>
            {/* Close (mobile) */}
            <button
              onClick={closeMobile}
              className="md:hidden h-7 w-7 flex items-center justify-center rounded-md text-gray-400 hover:bg-white/10 hover:text-white"
              aria-label="Menu sluiten"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* WIE ZIT HIER?
            Op een gedeelde laptop, of met twee accounts naast elkaar, wil je in
            één oogopslag zien namens wie je werkt — zeker bij het bellen, waar
            een lead aan de verkeerde setter toegewezen raakt als je het
            misgokt. Daarom de voornaam groot en het e-mailadres eronder: de
            naam voor het gemak, het adres als het harde antwoord. */}
        {(naam || email) && (
          <div className="px-4 py-3 border-b border-white/10 flex items-center gap-2.5">
            <Link href="/admin/account" prefetch={false} onClick={closeMobile} title="Mijn account" className="h-8 w-8 shrink-0 rounded-full bg-white/10 text-white flex items-center justify-center text-sm font-semibold overflow-hidden">
              {fotoVersie && !fotoKapot
                ? <img src={`/api/admin/account/foto?v=${encodeURIComponent(fotoVersie)}`} alt="" className="h-full w-full object-cover" onError={() => setFotoKapot(true)} />
                : (naam || email || '?').charAt(0).toUpperCase()}
            </Link>
            <div className="min-w-0">
              <div className="text-sm font-medium text-white leading-tight truncate">
                {naam ? `Welkom, ${naam}` : 'Welkom'}
              </div>
              {email && <div className="text-[10px] text-gray-400 truncate" title={email}>{email}</div>}
            </div>
          </div>
        )}

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {/* Wie ook een personeelsdossier heeft: inklokken, planning en
              beschikbaarheid, met dezelfde login als het portaal. */}
          {mijnWerk && (
            <Link href="/team" prefetch={false} onClick={closeMobile} className="sidebar-item mb-3 text-white bg-white/[0.06] hover:bg-white/10">
              <Timer className="h-4 w-4 shrink-0" />
              Mijn werk · inklokken
            </Link>
          )}
          {visibleSections.map((section, si) => (
            <div key={section.title ?? `sec-${si}`} className={si > 0 ? 'mt-4' : ''}>
              {section.title && (
                <div className="px-3 mb-1 text-[11px] font-medium text-gray-500">
                  {section.title}
                </div>
              )}
              <div className="space-y-0.5">
                {section.items.map((item) => (
                  <NavItem key={item.href} item={item} onNavigate={closeMobile}
                    badge={item.badge ? (badges[item.badge] ?? 0) : 0} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* Instellingen (centraal beheer) + eigen account + uitloggen */}
        <div className="px-3 py-4 border-t border-white/10 space-y-0.5">
          <Link href="/admin/account" prefetch={false} onClick={closeMobile}
            className={cn('sidebar-item', padNu.startsWith('/admin/account') && 'active')}>
            <UserCircle className="h-4 w-4 shrink-0" />
            Mijn account
          </Link>
          {toonInstellingen && <OpslagMeter onNavigate={closeMobile} />}
          {toonInstellingen && (
            <Link href="/admin/instellingen" prefetch={false} onClick={closeMobile}
              className={cn('sidebar-item', padNu.startsWith('/admin/instellingen') && 'active')}>
              <Settings className="h-4 w-4 shrink-0" />
              Instellingen
            </Link>
          )}
          <button
            onClick={handleLogout}
            className="sidebar-item w-full text-red-300 hover:text-red-200 hover:bg-red-500/10"
          >
            <LogOut className="h-4 w-4 shrink-0" />
            Uitloggen
          </button>
        </div>
      </aside>
    </>
  )
}
