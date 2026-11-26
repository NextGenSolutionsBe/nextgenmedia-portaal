import { redirect } from 'next/navigation'
import { leesAdminIdentiteit } from '@/lib/admin-identiteit'
import { AdminSidebar } from '@/components/admin/sidebar'
import { AdminTopBar } from '@/components/admin/admin-topbar'
import { Toaster } from 'sonner'
import { leesInstellingen, leesPersoon, leesVoorkeuren } from '@/lib/instellingen/laden'
import { moduleBeschikbaar, magActie, MODULE_INSTELLINGEN_KEY } from '@/lib/instellingen/model'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { leesBedrijfFilter } from '@/lib/bedrijven/weergave'

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

  // Centrale instellingen voor de zijbalk (zichtbaarheid per tabblad, rol,
  // persoonlijke voorkeuren). Faalt dit, dan toont de zijbalk alles zoals vroeger.
  // Alles tegelijk: elke lezing apart wachten kostte vier rondes na elkaar.
  // Wie ook een personeelsdossier heeft (bv. een student met modules), krijgt
  // "Mijn werk": inklokken, planning en beschikbaarheid op dezelfde login.
  const dossierLezing = (async () => {
    try {
      const { data } = await createAdminSupabaseClient().from('personeel').select('id, actief').eq('auth_user_id', ik.userId).maybeSingle()
      return data as { id: string; actief: boolean | null } | null
    } catch { return null }
  })()
  const [instellingen, persoon, voorkeuren, dossier, bedrijfFilter] = await Promise.all([
    leesInstellingen(), leesPersoon(), leesVoorkeuren(ik.userId), dossierLezing, leesBedrijfFilter(ik.userId),
  ])
  const verborgenPersoonlijk = persoon ? voorkeuren : []
  const rol = persoon?.rol ?? (role === 'admin' ? 'hoofdbeheerder' : 'medewerker')
  const mijnWerk = !!dossier && dossier.actief !== false
  const toonInstellingen = role === 'admin' || (!!persoon && moduleBeschikbaar(instellingen, persoon, MODULE_INSTELLINGEN_KEY) && magActie(instellingen, persoon, MODULE_INSTELLINGEN_KEY, 'instellingen'))

  return (
    <div className="flex min-h-screen">
      <Toaster richColors position="top-right" />
      <AdminSidebar
        allowedModules={allowedModules}
        isEmployee={role === 'employee'}
        naam={ik.naam}
        email={ik.email}
        fotoVersie={ik.fotoVersie}
        instellingen={instellingen}
        rol={rol}
        verborgenPersoonlijk={verborgenPersoonlijk}
        toonInstellingen={toonInstellingen}
        mijnWerk={mijnWerk}
        bedrijfFilter={bedrijfFilter}
      />
      <main className="flex-1 min-w-0 md:ml-[var(--sidebar-width)] min-h-screen overflow-x-clip">
        <div className={`max-w-[1400px] mx-auto px-4 pb-8 md:pt-6 md:px-6 lg:px-8 ${role === 'admin' ? 'pt-0' : 'pt-16'}`}>
          {/* Topbar (zoek/notificaties) is admin-only: de onderliggende
              API's zijn dat ook — voor werknemers verbergen i.p.v. 403-ruis. */}
          {role === 'admin' && <AdminTopBar />}
          {children}
        </div>
      </main>
    </div>
  )
}
