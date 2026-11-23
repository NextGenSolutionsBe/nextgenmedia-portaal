'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { useRefresh } from '@/lib/use-refresh'
import { Logo } from '@/components/logo'
import { LayoutDashboard, Briefcase, ArrowLeftRight, LogOut, Menu, X, RefreshCcw } from 'lucide-react'

const NAV = [
  { label: 'Dashboard',   href: '/partner',              icon: LayoutDashboard, exact: true },
  { label: 'Opdrachten',  href: '/partner/assignments',  icon: Briefcase },
  { label: 'Settlements', href: '/partner/settlements',  icon: ArrowLeftRight },
]

export function PartnerSidebar({ partnerName }: { partnerName: string }) {
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

  return (
    <>
      {/* Mobile hamburger */}
      <button
        className={cn('md:hidden fixed top-3 left-3 z-50 h-10 w-10 flex items-center justify-center rounded-full glas shadow-md text-gray-900', mobileOpen && 'hidden')}
        onClick={() => setMobileOpen(true)}
        aria-label="Menu openen"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Backdrop */}
      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/40 z-40"
          onClick={closeMobile}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed left-3 top-3 bottom-3 w-[240px] max-w-[calc(100vw-24px)] glas rounded-[18px] shadow-xl text-gray-700 flex flex-col z-40 overflow-hidden',
          'transition-transform duration-300 ease-in-out',
          'md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-[110%]',
        )}
      >
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <Logo className="h-8 w-8 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium text-gray-900 leading-tight tracking-tight truncate">{partnerName}</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-gray-400">Partnerportaal</div>
            </div>
            {/* Refresh */}
            <button
              onClick={refresh}
              disabled={spinning}
              title="Pagina vernieuwen"
              className="h-8 w-8 flex items-center justify-center rounded-full text-gray-500 hover:bg-white hover:text-gray-900 hover:shadow-sm transition-colors"
            >
              <RefreshCcw className={cn('h-3.5 w-3.5', spinning && 'animate-spin')} />
            </button>
            {/* Close (mobile) */}
            <button
              onClick={closeMobile}
              className="md:hidden h-8 w-8 flex items-center justify-center rounded-full text-gray-500 hover:bg-white hover:text-gray-900"
              aria-label="Menu sluiten"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto no-scrollbar">
          {NAV.map((item) => {
            const isActive = item.exact ? pathname === item.href : pathname.startsWith(item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={closeMobile}
                className={cn('sidebar-item', isActive && 'active')}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        <div className="px-3 py-3 border-t border-black/[0.05]">
          <button onClick={handleLogout} className="sidebar-item w-full text-red-600 hover:text-red-700 hover:bg-red-50">
            <LogOut className="h-4 w-4" />
            Uitloggen
          </button>
        </div>
      </aside>
    </>
  )
}
