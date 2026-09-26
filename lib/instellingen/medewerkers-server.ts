import 'server-only'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { rolVanStaff } from './model'
import { ADMIN_ID_PREFIX, splitsNaam, type Medewerker } from './medewerkers'

type AuthUser = { id: string; email?: string | null; created_at?: string; last_sign_in_at?: string | null; banned_until?: string | null; user_metadata?: Record<string, unknown> | null }
const gebanned = (u: AuthUser | undefined) => !!u?.banned_until && new Date(u.banned_until).getTime() > Date.now()

/** Alle interne accounts: hoofdbeheerders (user_roles admin) + werknemers (staff_members). */
export async function lijstMedewerkers(): Promise<Medewerker[]> {
  const admin = createAdminSupabaseClient()
  const [{ data: roles }, { data: staff }, { data: login }, au] = await Promise.all([
    admin.from('user_roles').select('user_id').eq('role', 'admin'),
    admin.from('staff_members').select('id, auth_user_id, name, email, active, permissions, created_at, last_login_at, voornaam, achternaam, functie, rol, verwijderd_at, uitnodiging_verzonden_at').order('created_at', { ascending: true }),
    admin.from('login_settings').select('auth_user_id, two_factor_required'),
    admin.auth.admin.listUsers({ page: 1, perPage: 1000 }).catch(() => ({ data: { users: [] as AuthUser[] } })),
  ])
  const users = new Map<string, AuthUser>(((au.data?.users ?? []) as AuthUser[]).map((u) => [u.id, u]))
  const tfa = new Map(((login ?? []) as { auth_user_id: string; two_factor_required: boolean }[]).map((r) => [r.auth_user_id, r.two_factor_required]))
  const adminIds = new Set(((roles ?? []) as { user_id: string }[]).map((r) => r.user_id))

  const uit: Medewerker[] = []
  for (const uid of adminIds) {
    const u = users.get(uid)
    const naam = String(u?.user_metadata?.full_name ?? u?.user_metadata?.name ?? '').trim()
    const { voornaam, achternaam } = splitsNaam(naam)
    uit.push({
      id: `${ADMIN_ID_PREFIX}${uid}`, authUserId: uid, isAdmin: true, email: u?.email ?? null, naam: naam || null,
      voornaam: voornaam || null, achternaam: achternaam || null, functie: 'Zaakvoerder', rol: 'hoofdbeheerder', permissions: null,
      actief: !gebanned(u), gearchiveerd: false, laatsteLogin: u?.last_sign_in_at ?? null, aangemaakt: u?.created_at ?? null,
      uitnodigingOp: null, tweeFactor: tfa.get(uid) !== false,
    })
  }
  type StaffRij = { id: string; auth_user_id: string | null; name: string | null; email: string | null; active: boolean; permissions: string[] | null; created_at: string; last_login_at: string | null; voornaam: string | null; achternaam: string | null; functie: string | null; rol: string | null; verwijderd_at: string | null; uitnodiging_verzonden_at: string | null }
  for (const s of (staff ?? []) as StaffRij[]) {
    if (s.auth_user_id && adminIds.has(s.auth_user_id)) continue
    const u = s.auth_user_id ? users.get(s.auth_user_id) : undefined
    const gesplitst = splitsNaam(s.name)
    uit.push({
      id: s.id, authUserId: s.auth_user_id, isAdmin: false, email: s.email, naam: s.name,
      voornaam: s.voornaam ?? (gesplitst.voornaam || null), achternaam: s.achternaam ?? (gesplitst.achternaam || null), functie: s.functie,
      rol: rolVanStaff(s.rol), permissions: Array.isArray(s.permissions) ? s.permissions : [],
      actief: s.active !== false && !s.verwijderd_at, gearchiveerd: !!s.verwijderd_at,
      laatsteLogin: u?.last_sign_in_at ?? s.last_login_at, aangemaakt: s.created_at, uitnodigingOp: s.uitnodiging_verzonden_at,
      tweeFactor: s.auth_user_id ? tfa.get(s.auth_user_id) !== false : true,
    })
  }
  return uit
}
