import { redirect } from 'next/navigation'
import { getSessionUser, getUserRole, getStaffRow } from '@/lib/supabase/server'
import { AdminSidebar } from '@/components/admin/sidebar'
import { AdminTopBar } from '@/components/admin/admin-topbar'
import { AiAssistant } from '@/components/admin/ai-assistant'
import { Toaster } from 'sonner'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  // Rol + rechten via service-role lezen (bypasst de restrictive user_roles-RLS;
  // een werknemer kan zijn eigen rol anders niet lezen → login-loop).
  // Deze lezingen zijn gedeeld binnen het verzoek (React cache), dus als een
  // pagina of guard hieronder hetzelfde opvraagt kost dat geen tweede rondgang.
  let role = await getUserRole(user.id)

  // Werknemer = enkel toegestane modules in de sidebar (admin = alles → undefined).
  // staff_members is de bron van waarheid: een actieve staff-rij maakt de
  // gebruiker werknemer, ook als de user_roles-rol ontbreekt (app_role-enum kan
  // 'employee' missen).
  let allowedModules: string[] | undefined
  if (role !== 'admin') {
    const staff = await getStaffRow(user.id)
    if (staff && staff.active !== false) {
      role = 'employee'
      allowedModules = Array.isArray(staff.permissions) ? (staff.permissions as string[]) : []
    } else if (staff && staff.active === false) {
      redirect('/login')
    }
  }

  if (role !== 'admin' && role !== 'employee') redirect('/login')

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Toaster richColors position="top-right" />
      <AdminSidebar allowedModules={allowedModules} isEmployee={role === 'employee'} />
      <main className="flex-1 min-w-0 md:ml-[var(--sidebar-width)] min-h-screen">
        <div className="max-w-[1400px] mx-auto px-4 pt-16 pb-8 md:pt-6 md:px-6 lg:px-8">
          {/* Topbar (zoek/notificaties/AI) is admin-only: de onderliggende
              API's zijn dat ook — voor werknemers verbergen i.p.v. 403-ruis. */}
          {role === 'admin' && <AdminTopBar />}
          {children}
        </div>
      </main>
      {role === 'admin' && <AiAssistant />}
    </div>
  )
}
