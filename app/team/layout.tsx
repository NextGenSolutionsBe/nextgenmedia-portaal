import { redirect } from 'next/navigation'
import { Toaster } from 'sonner'
import { leesTeamLid } from '@/lib/personeel/server'
import { getStaffRow, getUserRole } from '@/lib/supabase/server'
import { TeamShell } from './team-shell'

export const dynamic = 'force-dynamic'

/**
 * De persoonlijke werkomgeving van een medewerker uit Personeel. Enkel eigen
 * gegevens; geen loon, kosten of gegevens van collega's. De middleware laat
 * hier enkel actieve medewerkers met een niet-geblokkeerde login binnen.
 */
export default async function TeamLayout({ children }: { children: React.ReactNode }) {
  const lid = await leesTeamLid()
  if (!lid) redirect('/login?reden=geen_toegang')
  // Werknemers met portaaltoegang (bv. content) houden een knop terug naar het portaal.
  const staff = (await getStaffRow(lid.auth_user_id)) as { active?: boolean } | null
  const portaal = (!!staff && staff.active !== false) || (await getUserRole(lid.auth_user_id)) === 'admin'
  return (
    <>
      <Toaster richColors position="top-center" />
      <TeamShell voornaam={lid.voornaam} portaal={portaal}>{children}</TeamShell>
    </>
  )
}
