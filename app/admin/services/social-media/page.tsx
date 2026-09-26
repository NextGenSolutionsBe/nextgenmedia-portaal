import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { SocialMediaAdmin } from './social-media-admin'

export const dynamic = 'force-dynamic'

async function getData(clientId?: string) {
  try {
    const admin = createAdminSupabaseClient()

    // Fetch all clients AND their services separately — avoids FK join failures
    const [{ data: allClients }, { data: socialServices }, { data: items }, { data: contentClients }] = await Promise.all([
      admin.from('clients').select('id, company_name').order('company_name'),
      admin.from('client_services')
        .select('client_id')
        .eq('service_slug', 'social-media')
        .eq('active', true),
      clientId
        ? admin.from('social_content_items')
          .select('*')
          .eq('client_id', clientId)
          .order('planned_date', { ascending: true })
        : admin.from('social_content_items')
          .select('*')
          .order('planned_date', { ascending: false })
          .limit(200),
      // Klanten die al content hebben — zodat een klant met content NOOIT uit
      // het keuzemenu valt (voorkomt "verdwenen" content).
      admin.from('social_content_items').select('client_id'),
    ])

    // Toon klanten met een actieve social-media-dienst ÓF met bestaande content.
    const socialClientIds = new Set((socialServices ?? []).map((s) => s.client_id))
    for (const r of contentClients ?? []) if (r.client_id) socialClientIds.add(r.client_id)
    const clients = (allClients ?? []).filter((c) => socialClientIds.has(c.id))

    return { clients, items: items ?? [] }
  } catch {
    return { clients: [], items: [] }
  }
}

export default async function SocialMediaPage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>
}) {
  const { client: clientId } = await searchParams
  const { clients, items } = await getData(clientId)

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Social Media</h1>
        <p className="text-sm text-gray-500 mt-0.5">Beheer contentkalenders en scripts per klant</p>
      </div>
      <SocialMediaAdmin
        clients={clients as Array<{ id: string; company_name: string }>}
        initialItems={(items ?? []).map((it: any) => ({
          ...it,
          platforms: Array.isArray(it.platforms) ? it.platforms : it.platform ? [it.platform] : [],
        }))}
        initialClientId={clientId}
      />
    </div>
  )
}
