import 'server-only'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { User } from '@supabase/supabase-js'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { fotoVersie } from '@/lib/account'
import { FOUNDER_EMAILS } from '@/lib/founders'
export { fotoVersie, geldigEmail, wachtwoordFout, MIN_WACHTWOORD } from '@/lib/account'

/**
 * Mijn account: elke interne gebruiker beheert hier zijn EIGEN naam,
 * e-mailadres (= login), wachtwoord en profielfoto. Nooit die van iemand
 * anders: alles hangt aan de ingelogde sessie. E-mail en wachtwoord wijzigen
 * vraagt het huidige wachtwoord.
 *
 * De foto staat in de privébucket `accounts` (pad in user_metadata.avatar_pad)
 * en wordt enkel via een kortlevende ondertekende link getoond.
 */

export const ACCOUNT_BUCKET = 'accounts'
export const MAX_FOTO = 3 * 1024 * 1024
export const FOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const

export type Profiel = { voornaam: string; achternaam: string; email: string; fotoVersie: string | null; oprichter: boolean }

const meta = (u: User, k: string) => {
  const v = u.user_metadata?.[k]
  return typeof v === 'string' ? v.trim() : ''
}


export async function leesProfiel(u: User): Promise<Profiel> {
  let voornaam = meta(u, 'voornaam'), achternaam = meta(u, 'achternaam')
  if (!voornaam) {
    const vol = meta(u, 'name') || meta(u, 'full_name')
    if (vol) { const [v, ...r] = vol.split(/\s+/); voornaam = v; achternaam = achternaam || r.join(' ') }
  }
  if (!voornaam) {
    // Werknemer zonder naam op het account: die van de werknemersfiche.
    const { data } = await createAdminSupabaseClient().from('staff_members').select('voornaam, achternaam, name').eq('auth_user_id', u.id).maybeSingle()
    const s = data as { voornaam?: string | null; achternaam?: string | null; name?: string | null } | null
    voornaam = (s?.voornaam ?? s?.name?.split(/\s+/)[0] ?? '').trim()
    achternaam = (s?.achternaam ?? s?.name?.split(/\s+/).slice(1).join(' ') ?? '').trim()
  }
  const email = u.email ?? ''
  return { voornaam, achternaam, email, fotoVersie: fotoVersie(u), oprichter: FOUNDER_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase()) }
}

/** Klopt het huidige wachtwoord? Via een losse aanmelding die meteen weer afgemeld wordt. */
export async function controleerWachtwoord(email: string, wachtwoord: string): Promise<boolean> {
  if (!email || !wachtwoord) return false
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anon) throw new Error('Supabase is niet ingesteld.')
  const los = createSupabaseClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
  const { data, error } = await los.auth.signInWithPassword({ email, password: wachtwoord })
  if (error || !data.session) return false
  // Deze extra sessie meteen intrekken; de gewone sessie blijft.
  await los.auth.signOut({ scope: 'local' }).catch(() => {})
  return true
}
