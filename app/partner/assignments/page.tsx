export const dynamic = 'force-dynamic'

import { createClient, createAdminSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PartnerAssignmentsClient } from './assignments-client'

// Heuristic fallback when the `origin` column hasn't been migrated yet:
// a partner proposal has no client and no roles assigned.
function inferOrigin(a: {
  origin?: string | null
  client_id?: string | null
  roles?: string[] | null
}): 'admin' | 'partner' {
  if (a.origin === 'partner' || a.origin === 'admin') return a.origin
  const noRoles = !a.roles || a.roles.length === 0
  if (!a.client_id && noRoles) return 'partner'
  return 'admin'
}

export default async function PartnerAssignmentsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: partner } = await supabase
    .from('freelancers').select('id, hourly_rate').eq('user_id', user.id).maybeSingle()
  if (!partner) redirect('/login')

  // select('*') so the new `origin` column is included without breaking on
  // schema variants. Separate query — avoids PostgREST FK join failures.
  const { data: assignments } = await supabase
    .from('freelancer_assignments')
    .select('*')
    .eq('freelancer_id', partner.id)
    .order('created_at', { ascending: false })

  // Fetch client names via admin client (partners don't have direct client access via RLS)
  const clientIds = Array.from(new Set((assignments ?? []).map((a) => a.client_id).filter((v): v is string => !!v)))
  let clientMap = new Map<string, string>()
  if (clientIds.length > 0) {
    const admin = createAdminSupabaseClient()
    const { data: clients } = await admin
      .from('clients')
      .select('id, company_name')
      .in('id', clientIds)
    clientMap = new Map((clients ?? []).map((c) => [c.id, c.company_name]))
  }

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Opdrachten</h1>
        <p className="text-sm text-gray-500 mt-0.5">Opdrachten van NextGenMedia en uw eigen voorstellen</p>
      </div>
      <PartnerAssignmentsClient
        partnerId={partner.id}
        hourlyRate={partner.hourly_rate ?? null}
        initialAssignments={(assignments ?? []).map((a) => ({
          id: a.id as string,
          title: a.title as string,
          description: (a.description ?? null) as string | null,
          status: a.status as string,
          budget: (a.budget ?? null) as number | null,
          payout: (a.payout ?? null) as number | null,
          deadline: (a.deadline ?? null) as string | null,
          created_at: a.created_at as string,
          service_slug: (a.service_slug ?? null) as string | null,
          origin: inferOrigin(a),
          client_name: a.client_id ? (clientMap.get(a.client_id) ?? null) : null,
        }))}
      />
    </div>
  )
}
