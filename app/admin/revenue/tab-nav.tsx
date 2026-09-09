'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'

// Eén financieel dashboard: Prognose (centraal) + Kosten. De overige pagina's
// (overzicht/cashflow/contracten/agency/aandeelhouders/instellingen) blijven
// bestaan maar zijn niet meer gelinkt.
const TABS = [
  { href: '/admin/revenue/omzet', label: 'Overzicht' },
  { href: '/admin/revenue/kosten', label: 'Kosten' },
  { href: '/admin/revenue/framer', label: 'Framer' },
]

export function TabNav() {
  const pathname = usePathname()
  const sp = useSearchParams()
  const qs = sp.toString()

  return (
    <div className="border-b border-gray-200 -mb-px overflow-x-auto">
      <div className="flex gap-1 min-w-max">
        {TABS.map((t) => {
          const active = pathname.startsWith(t.href)
          return (
            <Link
              key={t.href}
              href={qs ? `${t.href}?${qs}` : t.href}
              className={`px-3 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                active ? 'border-black text-black' : 'border-transparent text-gray-500 hover:text-gray-800'
              }`}
            >
              {t.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}
