import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { buildLifecycle, type ClientLifecycle } from '@/lib/lifecycle'

type SC = { client_id: string; start_date: string | null; end_date: string | null; config: Record<string, unknown> | null }

/** Alle actieve Social Media-klanten met hun afgeleide lifecycle. */
export async function loadActiveSocialLifecycles(now = new Date()): Promise<ClientLifecycle[]> {
  const admin = createAdminSupabaseClient()
  const [{ data: svc }, { data: clients }, { data: contracts }, { data: items }] = await Promise.all([
    admin.from('client_services').select('client_id').eq('service_slug', 'social-media').eq('active', true),
    admin.from('clients').select('id, company_name').is('archived_at', null),
    admin.from('service_contracts').select('client_id, start_date, end_date, config').eq('service_slug', 'social-media'),
    admin.from('social_content_items').select('client_id'),
  ])

  const activeIds = new Set((svc ?? []).map((s) => s.client_id))
  const nameById = new Map((clients ?? []).map((c) => [c.id, c.company_name]))
  const planningIds = new Set((items ?? []).map((i: { client_id: string }) => i.client_id))

  // Meest recente social-contract per klant
  const contractByClient = new Map<string, SC>()
  for (const c of (contracts ?? []) as SC[]) {
    const prev = contractByClient.get(c.client_id)
    if (!prev || (c.start_date ?? '') > (prev.start_date ?? '')) contractByClient.set(c.client_id, c)
  }

  const out: ClientLifecycle[] = []
  for (const id of activeIds) {
    if (!nameById.has(id)) continue
    const sc = contractByClient.get(id)
    const months = sc?.config && typeof sc.config === 'object' ? Number((sc.config as Record<string, unknown>).contract_months) || null : null
    out.push(buildLifecycle({
      clientId: id, companyName: nameById.get(id) ?? '—',
      startDate: sc?.start_date ?? null, contractMonths: months, endDate: sc?.end_date ?? null,
      hasPlanning: planningIds.has(id),
    }, now))
  }
  return out.sort((a, b) => a.companyName.localeCompare(b.companyName))
}

/** Laatste werkdag van een maand (voor "rapportering"). */
export function lastWorkday(year: number, month: number): Date {
  const d = new Date(year, month + 1, 0)
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1)
  return d
}

/** Eerstvolgende rapporteringsdatum (laatste werkdag deze of volgende maand). */
export function nextReportingDate(now = new Date()): string {
  const thisMonth = lastWorkday(now.getFullYear(), now.getMonth())
  if (thisMonth >= new Date(now.getFullYear(), now.getMonth(), now.getDate())) return thisMonth.toISOString().slice(0, 10)
  return lastWorkday(now.getFullYear(), now.getMonth() + 1).toISOString().slice(0, 10)
}
