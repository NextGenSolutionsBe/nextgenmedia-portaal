import { redirect } from 'next/navigation'
import Link from 'next/link'
import { UserCog, Settings } from 'lucide-react'
import { requireAdmin } from '@/lib/supabase/server'
import { SectieMedewerkers } from '@/app/admin/instellingen/sectie-medewerkers'

export const dynamic = 'force-dynamic'

/**
 * Werknemers = hetzelfde scherm als Instellingen → Medewerkers. Eén bron, één
 * component; deze pagina blijft bestaan voor bestaande links en de zijbalk.
 */
export default async function WerknemersPage() {
  if (!(await requireAdmin())) redirect('/admin')
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><UserCog className="h-6 w-6" />Werknemers</h1>
          <p className="text-sm text-gray-500 mt-0.5">Interne accounts, rollen en modules. Rechten per rol en de overige instellingen staan onder Instellingen.</p>
        </div>
        <Link href="/admin/instellingen?tab=rechten" prefetch={false} className="btn-secondary"><Settings className="h-4 w-4" />Gebruikersrechten</Link>
      </div>
      <SectieMedewerkers isAdmin />
    </div>
  )
}
