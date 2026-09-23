'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { Timer, CalendarDays, CalendarPlus, ListChecks, Bell, LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Logo } from '@/components/logo'

const NAV = [
  { href: '/team', label: 'Klok', icon: Timer, exact: true },
  { href: '/team/planning', label: 'Planning', icon: CalendarDays },
  { href: '/team/beschikbaarheid', label: 'Beschikbaar', icon: CalendarPlus },
  { href: '/team/uren', label: 'Uren', icon: ListChecks },
  { href: '/team/meldingen', label: 'Meldingen', icon: Bell },
]

/** Mobiele shell: kop bovenaan, navigatie onderaan (duim-vriendelijk), op desktop gecentreerd. */
export function TeamShell({ voornaam, children }: { voornaam: string; children: React.ReactNode }) {
  const pad = usePathname()
  const router = useRouter()
  const [ongelezen, setOngelezen] = useState(0)

  useEffect(() => {
    let weg = false
    const haal = () => fetch('/api/team/meldingen', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
      if (!weg) setOngelezen(((j.meldingen ?? []) as { gelezen_op: string | null }[]).filter((m) => !m.gelezen_op).length)
    }).catch(() => {})
    haal()
    const t = setInterval(haal, 60000)
    return () => { weg = true; clearInterval(t) }
  }, [pad])

  const uitloggen = async () => { await createClient().auth.signOut(); router.replace('/login') }

  return (
    <div className="min-h-dvh bg-gray-50 flex flex-col">
      <header className="sticky top-0 z-30 bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto flex items-center justify-between px-4 h-14">
          <div className="flex items-center gap-2"><Logo className="h-8 w-8" /><span className="font-semibold text-sm">Hoi {voornaam}</span></div>
          <button type="button" onClick={uitloggen} className="text-xs text-gray-500 hover:text-black inline-flex items-center gap-1"><LogOut className="h-4 w-4" />Uitloggen</button>
        </div>
      </header>
      <main className="flex-1 w-full max-w-2xl mx-auto px-4 py-4 pb-28">{children}</main>
      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-gray-200 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-2xl mx-auto grid grid-cols-5">
          {NAV.map((n) => {
            const actief = n.exact ? pad === n.href : pad.startsWith(n.href)
            const Icon = n.icon
            return (
              <Link key={n.href} href={n.href} prefetch={false} className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${actief ? 'text-black font-semibold' : 'text-gray-500'}`}>
                <span className={`rounded-full px-3 py-1 ${actief ? 'bg-[#fff848]' : ''}`}><Icon className="h-5 w-5" /></span>
                {n.label}
                {n.href === '/team/meldingen' && ongelezen > 0 && <span className="absolute top-1 right-[22%] min-w-4 h-4 px-1 rounded-full bg-red-600 text-white text-[10px] leading-4 text-center">{ongelezen}</span>}
              </Link>
            )
          })}
        </div>
      </nav>
    </div>
  )
}
