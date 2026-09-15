import { createClient, createAdminSupabaseClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { PartnerSidebar } from '@/components/partner/sidebar'

export default async function PartnerLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Rol via service-role (bypasst de restrictive user_roles-RLS die niet-admins
  // hun eigen rol laat lezen → anders login-loop voor partners).
  const admin = createAdminSupabaseClient()
  const { data: roleData } = await admin
    .from('user_roles').select('role').eq('user_id', user.id).maybeSingle()
  if (roleData?.role !== 'freelancer') redirect('/login')

  const { data: partner } = await admin
    .from('freelancers').select('name').eq('user_id', user.id).maybeSingle()

  return (
    <div className="min-h-screen bg-gray-50">
      <PartnerSidebar partnerName={partner?.name ?? 'Partner'} />
      <main className="md:ml-[var(--sidebar-width)]">
        <div className="max-w-[1200px] mx-auto px-4 pt-20 pb-8 md:pt-6 md:px-6 lg:px-8">
          {children}
        </div>
      </main>
    </div>
  )
}
