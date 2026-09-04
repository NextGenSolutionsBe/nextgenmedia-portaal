import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { WebsiteAdmin } from './website-admin'
import { MaintenanceOverview } from './maintenance-overview'

export const dynamic = 'force-dynamic'

const STORAGE_BUCKET = 'contracts'
const SIGNED_URL_TTL = 60 * 60 * 24 // 24 h for admin view

async function getData() {
  try {
    const admin = createAdminSupabaseClient()

    // Three separate queries — avoids FK join failures (client_services!inner was silently breaking).
    // Show ALL clients with a webdesign service record (active OR inactive) — so admin
    // sees newly-assigned webdesign clients before access is granted, with a status badge.
    const [{ data: requestRows }, { data: allClients }, { data: webdesignServices }] = await Promise.all([
      admin.from('webdesign_change_requests').select('*').order('created_at', { ascending: false }),
      admin.from('clients').select('id, company_name'),
      admin.from('client_services').select('client_id, active').eq('service_slug', 'webdesign'),
    ])

    const clientMap = new Map((allClients ?? []).map((c) => [c.id, c]))
    const webdesignServiceMap = new Map(
      (webdesignServices ?? []).map((s) => [s.client_id, Boolean(s.active)])
    )
    // Build the websiteClients list in the same pass we walk allClients for the map
    const websiteClients: Array<{ id: string; company_name: string; active: boolean }> = []
    for (const c of allClients ?? []) {
      if (webdesignServiceMap.has(c.id)) {
        websiteClients.push({
          id: c.id,
          company_name: c.company_name,
          active: webdesignServiceMap.get(c.id) ?? false,
        })
      }
    }

    // Regenerate signed URLs for any requests that have stored image_paths.
    // If image_paths column doesn't exist (migration 20260527000004 not yet run),
    // fall back to whatever image_urls were stored (may be expired but still usable).
    const requests = await Promise.all(
      (requestRows ?? []).map(async (r) => {
        let imageUrls: string[] = Array.isArray(r.image_urls) ? r.image_urls : []

        const paths: string[] = Array.isArray(r.image_paths) ? r.image_paths : []
        if (paths.length > 0) {
          const freshUrls = await Promise.all(
            paths.map(async (path) => {
              try {
                const { data } = await admin.storage.from(STORAGE_BUCKET).createSignedUrl(path, SIGNED_URL_TTL)
                return data?.signedUrl ?? null
              } catch {
                return null
              }
            })
          )
          imageUrls = freshUrls.filter((u): u is string => u !== null)
        }

        return {
          ...r,
          image_urls: imageUrls,
          image_paths: paths,
          clients: r.client_id ? (clientMap.get(r.client_id) ?? null) : null,
        }
      })
    )

    return { requests, clients: websiteClients }
  } catch {
    return { requests: [], clients: [] }
  }
}

export default async function WebsitePage() {
  const { requests, clients } = await getData()

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Website</h1>
        <p className="text-sm text-gray-500 mt-0.5">Onderhoudsvragen en websiteklanten beheren</p>
      </div>
      <MaintenanceOverview />
      <WebsiteAdmin
        initialRequests={requests as Array<{
          id: string; title: string; description: string | null; kind: string;
          categories?: string[] | null;
          status: string; image_urls: string[]; admin_notes: string | null;
          created_at: string; updated_at: string;
          clients: { id: string; company_name: string } | null;
        }>}
        clients={clients as Array<{ id: string; company_name: string; active: boolean }>}
      />
    </div>
  )
}
