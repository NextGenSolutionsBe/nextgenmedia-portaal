import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { canonicalStatus } from '@/lib/contract-status'

// Compacte, read-only momentopname van het platform voor NextGen AI.
// Bevat enkel afgeleide vlaggen/cijfers — geen gevoelige data — zodat de AI
// vragen kan beantwoorden ("welke klanten zonder contract/prognose/framer",
// "welke facturen vandaag") zonder zelf iets te wijzigen.

export type AiSnapshot = {
  generatedAt: string
  totals: { clients: number; invoicesToSend: number; contractsToFollowUp: number }
  clients: Array<{
    id: string; name: string
    contracts: number; signed: number
    forecast: boolean; framer: boolean
    services: string[]
  }>
}

export async function buildAiSnapshot(): Promise<AiSnapshot> {
  const admin = createAdminSupabaseClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const safe = async <T,>(p: PromiseLike<{ data: T[] | null }>): Promise<T[]> => { try { return (await p).data ?? [] } catch { return [] } }

  const [clients, contracts, revenue, blogAcc, services, invoices] = await Promise.all([
    safe(admin.from('clients').select('id, company_name').limit(500)),
    safe(admin.from('contracts').select('client_id, status').limit(2000)),
    safe(admin.from('revenue_entries').select('client_id').limit(5000)),
    safe(admin.from('blog_accounts').select('client_id, framer_project_url').limit(2000)),
    safe(admin.from('client_services').select('client_id, service_slug, active').limit(5000)),
    safe(admin.from('invoices').select('status').limit(5000)),
  ]) as [
    { id: string; company_name: string }[],
    { client_id: string | null; status: string }[],
    { client_id: string | null }[],
    { client_id: string | null; framer_project_url: string | null }[],
    { client_id: string | null; service_slug: string; active: boolean }[],
    { status: string }[],
  ]

  const contractCount = new Map<string, number>()
  const signedCount = new Map<string, number>()
  let contractsToFollowUp = 0
  for (const c of contracts) {
    if (!c.client_id) continue
    contractCount.set(c.client_id, (contractCount.get(c.client_id) ?? 0) + 1)
    if (canonicalStatus(c.status) === 'getekend') signedCount.set(c.client_id, (signedCount.get(c.client_id) ?? 0) + 1)
    if (['verzonden', 'geopend', 'verlopen'].includes(canonicalStatus(c.status))) contractsToFollowUp++
  }
  const hasForecast = new Set(revenue.map((r) => r.client_id).filter(Boolean) as string[])
  const hasFramer = new Set(blogAcc.filter((b) => b.framer_project_url).map((b) => b.client_id).filter(Boolean) as string[])
  const svcByClient = new Map<string, string[]>()
  for (const s of services) {
    if (!s.client_id || !s.active) continue
    const arr = svcByClient.get(s.client_id) ?? []
    arr.push(s.service_slug); svcByClient.set(s.client_id, arr)
  }
  const invoicesToSend = invoices.filter((i) => i.status === 'te_factureren').length

  return {
    generatedAt: new Date().toISOString().slice(0, 10),
    totals: { clients: clients.length, invoicesToSend, contractsToFollowUp },
    clients: clients.map((c) => ({
      id: c.id, name: c.company_name,
      contracts: contractCount.get(c.id) ?? 0, signed: signedCount.get(c.id) ?? 0,
      forecast: hasForecast.has(c.id), framer: hasFramer.has(c.id),
      services: svcByClient.get(c.id) ?? [],
    })),
  }
}
