export const dynamic = 'force-dynamic'

import { requirePortalView, sessionCan } from '@/lib/portal-auth'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { laadOpleveringen } from '@/lib/opleveringen-server'
import { voorKlant } from '@/lib/opleveringen-portaal'
import { OpleveringenKlant } from '@/components/portal/opleveringen/opleveringen-klant'

/**
 * Klantapp — Opleveringen: losse video's (aftermovies, promotievideo's,
 * testimonials) bekijken, in volle kwaliteit downloaden en feedback geven,
 * met twee revisierondes. Bestanden blijven 3 dagen beschikbaar.
 */
export default async function PortalOpleveringenPage() {
  const session = await requirePortalView('opleveringen')
  const lijst = await laadOpleveringen(createAdminSupabaseClient(), { klant: session.clientId }).catch(() => [])
  return (
    <OpleveringenKlant
      opleveringen={lijst.filter((o) => o.versies.length).map((o) => voorKlant(o))}
      magDownloaden={sessionCan(session, 'opleveringen', 'download')}
      magFeedback={sessionCan(session, 'opleveringen', 'feedback')}
    />
  )
}
