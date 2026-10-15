'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { FileText, Send, Bell } from 'lucide-react'

const TABS = [
  { href: '/admin/email', label: 'E-mail Templates', icon: FileText, exact: true },
  { href: '/admin/email/sent', label: 'Verzonden mails', icon: Send },
  { href: '/admin/email/notifications', label: 'Interne meldingen', icon: Bell },
]

export function EmailTabs() {
  const pathname = usePathname()
  return (
    <div className="flex flex-wrap gap-1 border-b border-gray-200">
      {TABS.map((t) => {
        const active = t.exact ? pathname === t.href : pathname.startsWith(t.href)
        return (
          <Link key={t.href} href={t.href}
            className={cn('inline-flex items-center gap-1.5 px-3 py-2 text-sm border-b-2 -mb-px', active ? 'border-gray-900 text-gray-900 font-medium' : 'border-transparent text-gray-500 hover:text-gray-800')}>
            <t.icon className="h-4 w-4" />{t.label}
          </Link>
        )
      })}
    </div>
  )
}
