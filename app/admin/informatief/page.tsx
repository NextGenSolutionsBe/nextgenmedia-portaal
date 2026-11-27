export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { BookOpen } from 'lucide-react'
import { magIk } from '@/lib/instellingen/laden'
import { WerkinstructiesClient } from './werkinstructies-client'

/** Informatief: werkinstructies per bedrijf, dienst of rol, met versies en "Gelezen" (verbeterplan fase 4). */
export default async function InformatiefPage() {
  if (!(await magIk('info', 'bekijken'))) redirect('/admin')
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><BookOpen className="h-6 w-6" />Werkinstructies</h1>
        <p className="text-sm text-gray-500 mt-0.5">Hoe we het doen, per bedrijf, dienst of rol.</p>
      </div>
      <WerkinstructiesClient />
    </div>
  )
}
