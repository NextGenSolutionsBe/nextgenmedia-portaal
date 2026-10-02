export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { ContractsClient, type Contract } from './contracts-client'
import { typeNamen } from '@/lib/contracten/db'
import { leesActorNamen } from '@/lib/actor-namen'

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
  const namen = await leesActorNamen(admin, (contracts ?? []).map((c) => c.created_by as string | null))
  // Per contract: aantal gekoppelde + verstuurde facturen.
  const invByContract = new Map<string, { count: number; sent: number }>()
  for (const r of invoiceRows) {
    if (!r.contract_id) continue
    const cur = invByContract.get(r.contract_id) ?? { count: 0, sent: 0 }
    cur.count++
    if (['verstuurd', 'gefactureerd', 'betaald'].includes(r.status)) cur.sent++
    invByContract.set(r.contract_id, cur)
  }

  const enriched: Contract[] = (contracts ?? []).map((c) => {
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
      // start/end bestaan mogelijk niet op een oudere tabel → altijd null-safe.
      start_date: c.start_date ?? null,
      end_date: c.end_date ?? null,
      access_token: c.access_token,
      client_id: c.client_id ?? null,
      template_id: c.template_id ?? null,
      contract_type: c.contract_type ?? null,
      duration_type: c.duration_type ?? null,
      signer_name: c.signer_name ?? null,
      signer_email: c.signer_email ?? null,
      // Looptijdstatus staat los van de ondertekening; vóór de migratie = 'lopend'.
      looptijd_status: c.looptijd_status ?? 'lopend',
      stop_datum: c.stop_datum ?? null,
      stop_reden: c.stop_reden ?? null,
      heeftPdf: !!(c.pdf_path || c.signed_pdf_path),
      invoice_count: inv.count,
      invoice_sent: inv.sent,
      expected_invoice_count: expected,
      invoice_state: invoiceState as 'none' | 'partial' | 'full',
      client: clientMap.get(c.client_id) ?? null,
      door: c.created_by ? namen[c.created_by]?.kort ?? null : null,
    }
  })

  // Keuzelijst voor het contracttype-filter (valt vóór de migratie terug op de startlijst).
  const contracttypes = await typeNamen(admin)

  return { contracts: enriched, clients: clients ?? [], templates: templates ?? [], contracttypes }
}

export default async function ContractsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { contracts, clients, templates, contracttypes } = await getContracts()
  const sp = await searchParams
  const initialStatus = typeof sp?.status === 'string' ? sp.status : 'all'

  return (
    <ContractsClient
      initialStatus={initialStatus}
      initialContracts={contracts}
      clients={clients as Array<{ id: string; company_name: string }>}
      templates={templates as Array<{ id: string; name: string }>}
      contracttypes={contracttypes}
    />
  )
}
