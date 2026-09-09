export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { formatDate, formatEuro } from '@/lib/utils'
import { AssignmentsClient } from './assignments-client'

const ROLE_LABELS: Record<string, string> = {
  photographer: 'Fotograaf', videographer: 'Videograaf', editor: 'Editor',
  designer: 'Designer', copywriter: 'Copywriter', developer: 'Developer',
  strategist: 'Strateeg', other: 'Overig',
}

// Heuristic fallback for the `origin` column when the migration hasn't run yet:
// a partner proposal has a freelancer, no client, and no roles assigned.
function inferOrigin(a: {
  origin?: string | null
  freelancer_id: string | null
  client_id: string | null
  roles?: string[] | null
}): 'admin' | 'partner' {
  if (a.origin === 'partner' || a.origin === 'admin') return a.origin
  const noRoles = !a.roles || a.roles.length === 0
  if (a.freelancer_id && !a.client_id && noRoles) return 'partner'
  return 'admin'
}

async function getData() {
  try {
    const admin = createAdminSupabaseClient()
    // select('*') so the new `origin` column (and any schema variant) is included
    // without breaking when a column is missing.
    const [{ data: assignmentRows }, { data: allPartners }, { data: clientRows }] = await Promise.all([
      admin.from('freelancer_assignments')
        .select('*')
        .order('created_at', { ascending: false }),
      // ALL partners (we need names for inbound proposals even from inactive ones)
      admin.from('freelancers').select('id, name, email, roles, active').order('name'),
      admin.from('clients').select('id, company_name').order('company_name'),
    ])

    const freelancerMap = new Map((allPartners ?? []).map((f) => [f.id, f as { id: string; name: string; email: string; active: boolean }]))
    const clientMap = new Map((clientRows ?? []).map((c) => [c.id, c as { id: string; company_name: string }]))

    const assignments = (assignmentRows ?? []).map((a) => ({
      id: a.id as string,
      title: a.title as string,
      description: (a.description ?? null) as string | null,
      service_slug: (a.service_slug ?? null) as string | null,
      roles: (a.roles ?? []) as string[],
      status: a.status as string,
      budget: (a.budget ?? null) as number | null,
      payout: (a.payout ?? null) as number | null,
      deadline: (a.deadline ?? null) as string | null,
      client_id: (a.client_id ?? null) as string | null,
      freelancer_id: (a.freelancer_id ?? null) as string | null,
      created_at: a.created_at as string,
      origin: inferOrigin(a),
      deal_type: (a.deal_type ?? 'fixed') as string,
      clickup_task_id: (a.clickup_task_id ?? null) as string | null,
      clickup_assignee: (a.clickup_assignee ?? null) as string | null,
      freelancers: a.freelancer_id ? (freelancerMap.get(a.freelancer_id) ?? null) : null,
      clients: a.client_id ? (clientMap.get(a.client_id) ?? null) : null,
    }))

    // Only active partners are assignable in the "give work" dialog
    const activePartners = (allPartners ?? []).filter((p) => p.active !== false)

    return {
      assignments,
      partners: activePartners,
      clients: clientRows ?? [],
    }
  } catch {
    return { assignments: [], partners: [], clients: [] }
  }
}

export default async function AssignmentsPage() {
  const { assignments, partners, clients } = await getData()

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Opdrachten</h1>
        <p className="text-sm text-gray-500 mt-0.5">Beheer uitgaande opdrachten en inkomende voorstellen van partners</p>
      </div>
      <AssignmentsClient
        initialAssignments={assignments}
        partners={partners as Array<{ id: string; name: string; email: string; roles: string[] }>}
        clients={clients as Array<{ id: string; company_name: string }>}
        roleLabels={ROLE_LABELS}
      />
    </div>
  )
}
