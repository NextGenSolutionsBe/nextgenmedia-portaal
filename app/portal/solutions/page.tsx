export const dynamic = 'force-dynamic'

import { Workflow } from 'lucide-react'
import { requirePortalView, sessionCan } from '@/lib/portal-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { portaalSolutions } from '@/lib/ngs/levering-server'
import { SolutionsKlant } from './solutions-klant'

/**
 * Klantapp — Software en automatisatie (verbeterplan K88): het project bij NextGen
 * Solutions (fase, wat er gebouwd wordt, user stories goedkeuren) en wat in Care zit.
 * Altijd gekeyd op de geresolveerde klant; geen interne uren of notities.
 */
export default async function PortalSolutionsPage() {
  const session = await requirePortalView('solutions')
  const data = await portaalSolutions(createAdminSupabaseClient(), session.clientId).catch(() => ({ projecten: [], care: [] }))
  return (
    <div className="space-y-5 animate-fade-in">
      <div>
        <h1 className="text-2xl font-semibold flex items-center gap-2"><Workflow className="h-6 w-6" />Software en automatisatie</h1>
        <p className="text-sm text-gray-600 mt-1">Je project bij NextGen Solutions: waar we staan en wat jij nog moet goedkeuren.</p>
      </div>
      <SolutionsKlant data={data} magGoedkeuren={sessionCan(session, 'solutions', 'goedkeuren')} />
    </div>
  )
}
