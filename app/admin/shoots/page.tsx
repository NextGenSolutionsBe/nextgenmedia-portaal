import { redirect } from 'next/navigation'
import { Aperture } from 'lucide-react'
import { magIk } from '@/lib/instellingen/laden'
import { ShootPlanner } from './shoot-planner'

export const dynamic = 'force-dynamic'

/** Shoot planner: alle shoots in een kalender, met per shoot het plan per uur en locatie. */
export default async function ShootsPagina() {
  if (!(await magIk('shoots', 'bekijken'))) redirect('/admin')
  const toevoegen = await magIk('shoots', 'toevoegen')
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-semibold flex items-center gap-2"><Aperture className="h-6 w-6" />Shoot planner</h1>
        <p className="text-sm text-gray-500 mt-0.5">Briefing erin, plan eruit: waar, hoe laat, wie en wat.</p>
      </div>
      <ShootPlanner magToevoegen={!!toevoegen} />
    </div>
  )
}
