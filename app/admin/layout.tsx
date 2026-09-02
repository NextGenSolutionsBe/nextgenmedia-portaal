import { redirect } from 'next/navigation'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { AdminSidebar } from '@/components/admin/sidebar'
import { AdminTopBar } from '@/components/admin/admin-topbar'
import { AiAssistant } from '@/components/admin/ai-assistant'
import { Toaster } from 'sonner'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Rol + modulerechten komen bij voorkeur uit de middleware, die ze net al
  // opzocht; anders leest dit ze alsnog uit de database. Zie
  // lib/admin-identiteit.ts — daar staat ook waarom die header veilig is.
  // Werknemer = enkel toegestane modules in de sidebar (admin = alles → undefined).
  const ik = await leesAdminIdentiteit()
  if (!ik) redirect('/login')

  const role = ik.role
  const allowedModules = ik.modules

  if (role !== 'admin' && role !== 'employee') redirect('/login')

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Toaster richColors position="top-right" />
      <AdminSidebar
        allowedModules={allowedModules}
        isEmployee={role === 'employee'}
        naam={ik.naam}
        email={ik.email}
      />
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
