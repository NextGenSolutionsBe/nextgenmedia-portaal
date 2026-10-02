export const dynamic = 'force-dynamic'

import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { TemplatesClient } from './templates-client'

async function getData() {
  const admin = createAdminSupabaseClient()
  const [{ data: templates }, { data: clients }] = await Promise.all([
    admin.from('contract_templates').select('*').order('created_at', { ascending: false }),
    admin.from('clients').select('id, company_name').order('company_name'),
  ])
  const list = (templates ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    category: t.category ?? null,
    active: t.active ?? true,
    pdf_path: t.pdf_path ?? null,
    field_count: Array.isArray(t.detected_fields) ? t.detected_fields.length : 0,
    created_at: t.created_at,
  }))
  return { templates: list, clients: clients ?? [] }
}

export default async function ContractTemplatesPage() {
  const { templates, clients } = await getData()
  return (
    <TemplatesClient
      initialTemplates={templates as Array<{
        id: string; name: string; category: string | null; active: boolean
        pdf_path: string | null; field_count: number; created_at: string
      }>}
      clients={clients as Array<{ id: string; company_name: string }>}
    />
  )
}
