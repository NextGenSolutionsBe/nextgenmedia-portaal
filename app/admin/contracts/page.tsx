export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { ContractsClient } from './contracts-client'

async function getContracts() {
  const admin = createAdminSupabaseClient()

  // select('*') zodat ontbrekende kolommen (template_id vóór migratie) nooit breken.
  // Facturen apart ophalen (resilient: contract_id kan ontbreken vóór migratie).
  let invoiceRows: { contract_id: string | null; status: string }[] = []
  const [{ data: contracts }, { data: clients }, { data: templates }] = await Promise.all([
    admin.from('contracts').select('*').order('created_at', { ascending: false }).limit(1000),
    admin.from('clients').select('id, company_name').order('company_name'),
    admin.from('contract_templates').select('id, name').order('name'),
  ])
  try {
    const { data } = await admin.from('invoices').select('contract_id, status').not('contract_id', 'is', null).limit(5000)
    invoiceRows = (data ?? []) as typeof invoiceRows
  } catch { invoiceRows = [] }

  const clientMap = new Map((clients ?? []).map((c) => [c.id, c]))
  // Per contract: aantal gekoppelde + verstuurde facturen.
  const invByContract = new Map<string, { count: number; sent: number }>()
  for (const r of invoiceRows) {
    if (!r.contract_id) continue
    const cur = invByContract.get(r.contract_id) ?? { count: 0, sent: 0 }
    cur.count++
    if (['verstuurd', 'gefactureerd', 'betaald'].includes(r.status)) cur.sent++
    invByContract.set(r.contract_id, cur)
  }

  const enriched = (contracts ?? []).map((c) => {
    const inv = invByContract.get(c.id) ?? { count: 0, sent: 0 }
    const expected = c.expected_invoice_count ?? null
    const invoiceState = inv.count === 0 ? 'none'
      : (expected && inv.sent >= expected) || (!expected && inv.sent >= inv.count && inv.count > 0) ? 'full'
      : 'partial'
    return {
      id: c.id,
      title: c.title,
      status: c.status,
      service_slug: c.service_slug ?? null,
      signed_at: c.signed_at ?? null,
      sent_at: c.sent_at ?? null,
      created_at: c.created_at,
      expires_at: c.expires_at ?? null,
      access_token: c.access_token,
      client_id: c.client_id ?? null,
      template_id: c.template_id ?? null,
      contract_type: c.contract_type ?? null,
      duration_type: c.duration_type ?? null,
      signer_name: c.signer_name ?? null,
      signer_email: c.signer_email ?? null,
      invoice_count: inv.count,
      invoice_sent: inv.sent,
      expected_invoice_count: expected,
      invoice_state: invoiceState as 'none' | 'partial' | 'full',
      client: clientMap.get(c.client_id) ?? null,
    }
  })

  return { contracts: enriched, clients: clients ?? [], templates: templates ?? [] }
}

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { contracts, clients, templates } = await getContracts()
  const sp = await searchParams
  const initialStatus = typeof sp?.status === 'string' ? sp.status : 'all'

  return (
    <ContractsClient
      initialStatus={initialStatus}
      initialContracts={contracts as Array<{
        id: string
        title: string
        status: string
        service_slug: string | null
        signed_at: string | null
        sent_at: string | null
        created_at: string
        expires_at: string | null
        access_token: string
        client_id: string | null
        template_id: string | null
        contract_type: string | null
        duration_type: string | null
        signer_name: string | null
        signer_email: string | null
        invoice_count: number
        invoice_sent: number
        expected_invoice_count: number | null
        invoice_state: 'none' | 'partial' | 'full'
        client: { id: string; company_name: string } | null
      }>}
      clients={clients as Array<{ id: string; company_name: string }>}
      templates={templates as Array<{ id: string; name: string }>}
    />
  )
}
