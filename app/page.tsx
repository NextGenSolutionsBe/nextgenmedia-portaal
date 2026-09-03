import { redirect } from 'next/navigation'
import { createClient, createAdminSupabaseClient } from '@/lib/supabase/server'

export default async function Home() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Rol via service-role (bypasst de restrictive user_roles-RLS die niet-admins
  // hun eigen rol laat lezen → anders login-loop voor werknemers/klanten).
  const admin = createAdminSupabaseClient()
  const { data: roleData } = await admin
    .from('user_roles')
    .select('role')
    .eq('user_id', user.id)
    .maybeSingle()

  let role = roleData?.role as string | undefined

  // staff_members = bron van waarheid voor werknemers (het app_role-enum bevat
  // mogelijk geen 'employee', dus de rol-rij kan ontbreken).
  if (role !== 'admin' && role !== 'client' && role !== 'freelancer') {
    const { data: staff } = await admin
      .from('staff_members').select('active').eq('auth_user_id', user.id).maybeSingle()
    if (staff && staff.active !== false) role = 'employee'
  }

  // Werknemers horen — net als admins — in het admin-portaal.
  if (role === 'admin' || role === 'employee') redirect('/admin')
  if (role === 'client') redirect('/portal')
  if (role === 'freelancer') redirect('/partner')

  /**
   * Kantoorpartners hebben GEEN rol in user_roles — hun toegang blijkt uit een
   * actieve rij in kantoor_leden. Zonder deze tak viel zo iemand hieronder door
   * naar /login, terwijl hij net correct was ingelogd: een lus waar je met het
   * juiste wachtwoord niet uit kwam. Precies daarom leek "toevoegen" te werken
   * maar kon de partner er nooit in.
   *
   * Koppelen kan nog op e-mailadres staan: de rij wordt aangemaakt vóór het
   * account bestaat, dus auth_user_id is dan nog leeg (resolveKantoorSessie
   * legt die koppeling bij het eerste bezoek).
   */
  const lidFilter = user.email
    ? `auth_user_id.eq.${user.id},email.eq.${user.email}`
    : `auth_user_id.eq.${user.id}`
  const { data: kantoorLid } = await admin
    .from('kantoor_leden')
    .select('id')
    .or(lidFilter)
    .eq('actief', true)
    .limit(1)
    .maybeSingle()
  if (kantoorLid) redirect('/kantoor')

  redirect('/login')
}
