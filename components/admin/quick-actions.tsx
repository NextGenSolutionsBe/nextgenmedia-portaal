'use client'

import { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Plus, Users, FileText, Receipt, Newspaper, TrendingUp, ListChecks } from 'lucide-react'

// Globale Quick Actions: nieuw aanmaken zonder eerst naar een module te navigeren.
const ACTIONS = [
  { label: 'Nieuwe klant', href: '/admin/clients/new', icon: Users },
  { label: 'Nieuw contract', href: '/admin/contracts/new', icon: FileText },
  { label: 'Nieuwe factuur', href: '/admin/invoices', icon: Receipt },
  { label: 'Nieuwe blog', href: '/admin/blog-calendar', icon: Newspaper },
  { label: 'Nieuwe prognose', href: '/admin/revenue/omzet', icon: TrendingUp },
  { label: 'Nieuwe taak', href: '/admin/clients', icon: ListChecks },
]

export function QuickActions() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [])

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((v) => !v)} className="btn-primary text-sm whitespace-nowrap">
        <Plus className="h-4 w-4" />
        <span className="hidden sm:inline">Nieuw</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg py-1 z-50">
          {ACTIONS.map((a) => (
            <Link key={a.href} href={a.href} onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50">
              <a.icon className="h-4 w-4 text-gray-400" />
              {a.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
