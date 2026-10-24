import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { MonthClients } from './month-clients'

export async function MaandKlanten() {
  const admin = createAdminSupabaseClient()
  const { data } = await admin.from('clients').select('id, company_name').is('archived_at', null).order('company_name')
  const clients = ((data ?? []) as { id: string; company_name: string }[]).map((c) => ({ id: c.id, name: c.company_name }))
  return <MonthClients clients={clients} />
}
