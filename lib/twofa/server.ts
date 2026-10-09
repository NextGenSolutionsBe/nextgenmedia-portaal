import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { createClient as createSupabaseJs } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import { createAdminSupabaseClient, createClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { twoFactorRequired } from '@/lib/two-factor'
import { leesSleutel } from './geheimen'
import type { Kern, TotpRij, TwofaOpslag } from './kern'
import { SESSIE_TTL_MS, sessieIdUitToken, sessieStatus, type SessieRij } from './sessie'

/**
 * Serverkant van de tweede stap: opslag in Supabase (service-role), de huidige
 * sessie, de controle "is de tweede stap voltooid" voor de route-guards, en het
 * opnieuw controleren van het wachtwoord bij gevoelige wijzigingen.
 */

/** Header die de middleware zet (en inkomend ALTIJD wist) als de tweede stap in orde is. */
export const HDR_TWEEDE_STAP = 'x-ngm-2fa'

// ── Opslag ───────────────────────────────────────────────────────────────────

export function supabaseOpslag(): TwofaOpslag {
  const db = createAdminSupabaseClient()
  return {
    async lees(userId) {
      const { data, error } = await db.from('user_totp')
        .select('user_id, secret_enc, actief, geactiveerd_op, laatste_stap, setup_secret_enc, setup_gestart_op, setup_door')
        .eq('user_id', userId).maybeSingle()
      if (error) throw new Error(error.message)
      return (data as TotpRij | null) ?? null
    },
    async bewaarSetup(userId, setupEnc, op, door = null) {
      const bestaand = await this.lees(userId)
      if (bestaand?.actief) return false
      if (bestaand) {
        const { data, error } = await db.from('user_totp')
          .update({ setup_secret_enc: setupEnc, setup_gestart_op: op, setup_door: door, gewijzigd_op: op })
          .eq('user_id', userId).eq('actief', false).select('user_id')
        if (error) throw new Error(error.message)
        return (data ?? []).length === 1
      }
      const { error } = await db.from('user_totp').insert({ user_id: userId, actief: false, setup_secret_enc: setupEnc, setup_gestart_op: op, setup_door: door, gewijzigd_op: op })
      if (error) throw new Error(error.message)
      return true
    },
    async activeer(userId, setupEnc, stap, op) {
      const { data, error } = await db.from('user_totp')
        .update({ secret_enc: setupEnc, actief: true, geactiveerd_op: op, laatste_stap: stap, setup_secret_enc: null, setup_gestart_op: null, setup_door: null, gewijzigd_op: op })
        .eq('user_id', userId).eq('actief', false).eq('setup_secret_enc', setupEnc).select('user_id')
      if (error) throw new Error(error.message)
      return (data ?? []).length === 1
    },
    async claimStap(userId, stap) {
      const { data, error } = await db.from('user_totp')
        .update({ laatste_stap: stap })
        .eq('user_id', userId).eq('actief', true)
        .or(`laatste_stap.is.null,laatste_stap.lt.${Math.trunc(stap)}`)
        .select('user_id')
      if (error) throw new Error(error.message)
      return (data ?? []).length === 1
    },
    async verwijder(userId) {
      const { error } = await db.from('user_totp').delete().eq('user_id', userId)
      if (error) throw new Error(error.message)
    },
    async vervangHerstelcodes(userId, hashes) {
      const { error } = await db.from('user_herstelcodes').delete().eq('user_id', userId)
      if (error) throw new Error(error.message)
      if (hashes.length) {
        const { error: e2 } = await db.from('user_herstelcodes').insert(hashes.map((code_hash) => ({ user_id: userId, code_hash })))
        if (e2) throw new Error(e2.message)
      }
    },
    async gebruikHerstelcode(userId, hash, op) {
      const { data, error } = await db.from('user_herstelcodes')
        .update({ gebruikt_op: op })
        .eq('user_id', userId).eq('code_hash', hash).is('gebruikt_op', null)
        .select('id')
      if (error) throw new Error(error.message)
      return (data ?? []).length === 1
    },
    async aantalHerstelcodes(userId) {
      const { count } = await db.from('user_herstelcodes').select('id', { count: 'exact', head: true }).eq('user_id', userId).is('gebruikt_op', null)
      return count ?? 0
    },
  }
}

/** De kern met echte opslag, klok en (fail-closed) pogingslimiet. null = TOTP_ENC_KEY ontbreekt. */
export function maakKern(): Kern | null {
  const sleutel = leesSleutel()
  if (!sleutel) return null
  return {
    opslag: supabaseOpslag(),
    sleutel,
    nu: () => Date.now(),
    limiet: async (k, limit, windowSec) => (await rateLimit(k, { limit, windowSec, failClosed: true })).allowed,
  }
}

// ── Huidige sessie ───────────────────────────────────────────────────────────

export type Sessie = { user: User; sessionId: string | null; accessToken: string | null }

/** De ingelogde gebruiker + zijn Supabase-sessie-id (gecontroleerd via getUser). */
export const huidigeSessie = cache(async (): Promise<Sessie | null> => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  // getUser() heeft deze token net bij de Auth-server laten nakijken; het
  // session_id eruit lezen is dus veilig.
  const { data: { session } } = await supabase.auth.getSession()
  const accessToken = session?.access_token ?? null
  return { user, sessionId: sessieIdUitToken(accessToken), accessToken }
})

export async function leesSessieRij(sessionId: string | null): Promise<SessieRij | null> {
  if (!sessionId) return null
  const { data } = await createAdminSupabaseClient().from('twofa_sessies')
    .select('user_id, verloopt_op').eq('session_id', sessionId).maybeSingle()
  return (data as SessieRij | null) ?? null
}

/**
 * Heeft deze gebruiker in DEZE sessie de tweede stap voltooid (of is die voor
 * het account uitgezet)? Voor de route-guards (requireAdmin/requireStaff) en
 * de 2FA-beheerroutes. De middleware geeft zijn oordeel door via een header die
 * hij inkomend altijd wist; zonder die header kijken we het zelf na.
 */
export const tweedeStapVoltooid = cache(async (userId: string): Promise<boolean> => {
  try {
    if ((await headers()).get(HDR_TWEEDE_STAP) === userId) return true
  } catch { /* buiten een verzoek */ }
  const sessie = await huidigeSessie()
  if (!sessie || sessie.user.id !== userId) return false
  const rij = await leesSessieRij(sessie.sessionId)
  if (sessieStatus(rij, userId, Date.now()) === 'ok') return true
  return !(await twoFactorRequired(createAdminSupabaseClient(), userId))
})

/** De sessie markeren als "tweede stap voltooid" (na app-code, herstelcode of het koppelen van een app). */
export async function markeerSessie(userId: string, sessionId: string, methode: string): Promise<void> {
  const nu = Date.now()
  const { error } = await createAdminSupabaseClient().from('twofa_sessies').upsert({
    session_id: sessionId, user_id: userId, methode, totp_instellen: false,
    geverifieerd_op: new Date(nu).toISOString(), verloopt_op: new Date(nu + SESSIE_TTL_MS).toISOString(),
  }, { onConflict: 'session_id' })
  if (error) throw new Error(error.message)
}

export async function wisSessie(sessionId: string | null): Promise<void> {
  if (!sessionId) return
  await createAdminSupabaseClient().from('twofa_sessies').delete().eq('session_id', sessionId)
}

/**
 * Na een securitywijziging: alle ANDERE sessies van deze gebruiker intrekken —
 * hun 2FA-markering meteen (middleware/RLS), hun refresh-tokens bij Supabase.
 */
export async function trekAndereSessiesIn(sessie: Sessie): Promise<void> {
  const db = createAdminSupabaseClient()
  let q = db.from('twofa_sessies').delete().eq('user_id', sessie.user.id)
  if (sessie.sessionId) q = q.neq('session_id', sessie.sessionId)
  await q
  if (sessie.accessToken) await db.auth.admin.signOut(sessie.accessToken, 'others').catch(() => {})
}

/** Alle 2FA-markeringen van een gebruiker wissen (admin-reset). */
export async function wisAlleSessies(userId: string): Promise<void> {
  await createAdminSupabaseClient().from('twofa_sessies').delete().eq('user_id', userId)
}

/**
 * Klopt het wachtwoord? Via een losse Supabase-client zonder opslag; de sessie
 * die dat aanmaakt wordt meteen weer ingetrokken.
 */
export async function wachtwoordKlopt(email: string | null | undefined, wachtwoord: unknown): Promise<boolean> {
  if (!email || typeof wachtwoord !== 'string' || !wachtwoord) return false
  const c = createSupabaseJs(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  const { data, error } = await c.auth.signInWithPassword({ email, password: wachtwoord })
  if (error || !data.session) return false
  await c.auth.signOut({ scope: 'local' }).catch(() => {})
  return true
}

/** Intern account? (admin of actieve werknemer) */
export async function interneRol(userId: string): Promise<'admin' | 'employee' | null> {
  const db = createAdminSupabaseClient()
  const { data } = await db.from('user_roles').select('role').eq('user_id', userId).maybeSingle()
  if ((data as { role?: string } | null)?.role === 'admin') return 'admin'
  const { data: s } = await db.from('staff_members').select('active').eq('auth_user_id', userId).maybeSingle()
  return s && (s as { active?: boolean }).active !== false ? 'employee' : null
}

/** Heeft deze gebruiker een actieve authenticator-app? */
export async function appActief(userId: string): Promise<boolean> {
  const { data } = await createAdminSupabaseClient().from('user_totp').select('actief').eq('user_id', userId).maybeSingle()
  return !!(data as { actief?: boolean } | null)?.actief
}
