export const dynamic = 'force-dynamic'

import { redirect } from 'next/navigation'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { requirePortalView } from '@/lib/portal-auth'
import { PortalCms } from './portal-cms'

export default async function PortalCmsPage() {
  const session = await requirePortalView('cms')

  // Enkel tonen als de klant CMS-toegang heeft én er bewerkbare collecties zijn.
  const admin = createAdminSupabaseClient()
  const { data: client } = await admin.from('clients').select('cms_enabled').eq('id', session.clientId).maybeSingle()
  if (!client?.cms_enabled) redirect('/portal')
  const { count } = await admin
    .from('cms_collections').select('id', { count: 'exact', head: true })
    .eq('client_id', session.clientId).eq('client_editable', true)
  if (!count) redirect('/portal')

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Website-CMS</h1>
        <p className="text-sm text-gray-500 mt-0.5">Bewerk de inhoud van je website. Klik op “Opslaan & publiceren” om je wijzigingen live te zetten.</p>
      </div>
      <PortalCms />
    </div>
  )
}
