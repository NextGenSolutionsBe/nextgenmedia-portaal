import { redirect } from 'next/navigation'
import { createClient, createAdminSupabaseClient } from '@/lib/supabase/server'
import { FEATURES } from '@/lib/features'
import { pathToModule } from '@/lib/staff'
import { netteStartpagina } from '@/lib/team/rollen'

/**
 * Startpagina van een werknemer volgens zijn rolsjabloon (fase 4), enkel als hij
 * die module mag zien. Zonder sjabloon of bij twijfel: het Command Center.
 */
async function startpaginaVan(admin: ReturnType<typeof createAdminSupabaseClient>, userId: string): Promise<string> {
  try {
    const { data: s, error } = await admin.from('staff_members').select('rol_sjabloon, permissions').eq('auth_user_id', userId).maybeSingle()
    const rij = s as { rol_sjabloon: string | null; permissions: string[] | null } | null
    if (error || !rij?.rol_sjabloon) return '/admin'
    const { data: sj } = await admin.from('rol_sjablonen').select('startpagina').eq('key', rij.rol_sjabloon).maybeSingle()
    const pad = netteStartpagina((sj as { startpagina: string | null } | null)?.startpagina)
    if (!pad) return '/admin'
    const module = pathToModule(pad)
    return !module || (rij.permissions ?? []).includes(module) ? pad : '/admin'
  } catch { return '/admin' }
}

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
  if (role === 'admin') redirect('/admin')
  if (role === 'employee') redirect(await startpaginaVan(admin, user.id))
  if (role === 'client') redirect('/portal')

  /**
   * Kantoorlidmaatschap gaat vóór een oude partnerrol ('freelancer'). Een
   * account dat vroeger partner was en nu een Kantoor-partner is, moet in het
   * Kantoor belanden — zeker nu de partnermodule uit staat: /partner leidt dan
   * naar een omleiding naar /admin, die de gebruiker weer naar /login stuurt.
   * Zo leek "inloggen lukt niet", terwijl het wachtwoord gewoon klopte.
   */

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
  /**
   * Medewerkers uit Personeel (bv. studenten die per uur werken) hebben hun
   * eigen omgeving: inklokken, planning, beschikbaarheid. Geen rol in
   * user_roles; toegang volgt uit een actieve rij in `personeel`.
   */
  const { data: teamLid } = await admin
    .from('personeel')
    .select('id, actief, account_status')
    .or(user.email ? `auth_user_id.eq.${user.id},email.ilike.${user.email}` : `auth_user_id.eq.${user.id}`)
    .limit(1)
    .maybeSingle()
  if (teamLid && teamLid.actief !== false && teamLid.account_status !== 'geblokkeerd' && teamLid.account_status !== 'geen') redirect('/team')

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

  // Oude partnerrol zonder Kantoor: enkel naar het partnerportaal als dat aanstaat.
  if (role === 'freelancer' && FEATURES.partners) redirect('/partner')

  redirect('/login?reden=geen_toegang')
}
