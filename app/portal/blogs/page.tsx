import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { PortalBlogs, type PortalBlog } from './portal-blogs'
import { requirePortalView, sessionCan } from '@/lib/portal-auth'

export const dynamic = 'force-dynamic'

export default async function PortalBlogsPage() {
  const session = await requirePortalView('blogs')
  const canEdit = sessionCan(session, 'blogs', 'edit')
  const admin = createAdminSupabaseClient()

  const { data: accountsData } = await admin.from('blog_accounts').select('id').eq('client_id', session.clientId)
  const accountIds = (accountsData ?? []).map((a: { id: string }) => a.id)

  let blogs: PortalBlog[] = []
  if (accountIds.length > 0) {
    const { data } = await admin
      .from('blogs')
      .select('id, titel, slug, content, meta_title, meta_description, status, gepubliceerd_op, gegenereerd_op, laatst_bewerkt_door, laatst_bewerkt_op')
      .in('account_id', accountIds)
      .order('gegenereerd_op', { ascending: false })
    blogs = (data ?? []) as PortalBlog[]
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-black">Blogs</h1>
        <p className="text-sm text-gray-500 mt-1">Bekijk en bewerk je blogs. Een opgeslagen wijziging aan een gepubliceerde blog wordt automatisch op je website doorgevoerd.</p>
      </div>
      {accountIds.length === 0 ? (
        <div className="card-base text-sm text-gray-500">Er is nog geen blogaccount aan jouw bedrijf gekoppeld.</div>
      ) : (
        <PortalBlogs initialBlogs={blogs} canEdit={canEdit} />
      )}
    </div>
  )
}
