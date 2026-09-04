'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FileText, LayoutTemplate } from 'lucide-react'

// Eenvoudige tabnavigatie: Contracten ↔ Templates. Geen extra losse pagina's.
export function ContractTabs() {
  const pathname = usePathname()
  const isTemplates = pathname?.startsWith('/admin/contracts/templates')

  const tab = (active: boolean) =>
    `inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border transition-colors ${
      active ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
    }`

  return (
    <div className="flex items-center gap-2">
      <Link href="/admin/contracts" className={tab(!isTemplates)}>
        <FileText className="h-4 w-4" />
        Contracten
      </Link>
      <Link href="/admin/contracts/templates" className={tab(!!isTemplates)}>
        <LayoutTemplate className="h-4 w-4" />
        Templates
      </Link>
    </div>
  )
}
