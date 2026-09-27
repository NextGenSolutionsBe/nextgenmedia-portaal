// Tweestapsverificatie voor INTERNE accounts (admin + werknemers).
// Klanten en partners loggen gewoon met e-mail + wachtwoord in.
//
// Tweede factor: een code per mail (dit bestand) of een authenticator-app
// (lib/twofa/). Wie de stap doorliep, staat in twofa_sessies — per Supabase-
// sessie, zodat uitloggen of een securitywijziging het meteen intrekt.
//
// Edge-veilig: gebruikt uitsluitend Web Crypto (crypto.subtle), zodat dit zowel
// in de middleware (Edge runtime) als in API-routes (Node) werkt. Geen imports
// uit node:crypto.

/** Oud verificatiecookie (vóór twofa_sessies) — enkel nog om het te wissen. */
export const TWO_FA_COOKIE = 'ngm_2fa'
export const CODE_TTL_MS = 10 * 60 * 1000          // code 10 minuten geldig
export const MAX_ATTEMPTS = 5                       // pogingen per code
export const RESEND_COOLDOWN_MS = 60 * 1000         // minimaal 60s tussen codes

const encoder = new TextEncoder()

/** Peper voor de hash van mailcodes. Valt terug op de service-role key (server-only). */
function secret(): string {
  return process.env.AUTH_2FA_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
}

/** SHA-256 hex — codes worden NOOIT in leesbare vorm bewaard. */
export async function hashCode(code: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(`${secret()}:${code}`))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** Tijdconstante vergelijking — voorkomt dat responstijd de code verraadt. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** 6-cijferige code uit een cryptografisch veilige bron (geen Math.random). */
export function generateCode(): string {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return String(buf[0] % 1_000_000).padStart(6, '0')
}

/**
 * Moet dit account de toegestuurde code invullen?
 *
 * Standaard JA. Enkel een uitdrukkelijke rij in login_settings met
 * two_factor_required = false zet dat uit — en nooit voor een account met een
 * actieve authenticator-app. Elke andere uitkomst — geen rij,
 * tabel bestaat nog niet, database onbereikbaar — houdt de code verplicht.
 * De veilige kant is hier de standaard, niet de uitzondering.
 *
 * `db` is een Supabase-client; die wordt meegegeven omdat deze functie zowel in
 * de Edge-middleware als in gewone routes gebruikt wordt.
 */
export async function twoFactorRequired(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: { from: (t: string) => any },
  userId: string,
): Promise<boolean> {
  try {
    const [{ data, error }, app] = await Promise.all([
      db.from('login_settings').select('two_factor_required').eq('auth_user_id', userId).maybeSingle(),
      db.from('user_totp').select('actief').eq('user_id', userId).maybeSingle(),
    ])
    if (error) return true
    // Een actieve authenticator-app kan NIET met één klik uitgezet worden via
    // deze vrijstelling — dat zou de app-2FA zonder extra controle opheffen.
    // Uitzetten kan enkel via "2FA uitschakelen" (wachtwoord + code) of de
    // admin-reset (eigen wachtwoord + eigen app-code). Lezing mislukt → verplicht.
    if (app?.error || (app?.data as { actief?: boolean } | null)?.actief) return true
    return (data as { two_factor_required?: boolean } | null)?.two_factor_required !== false
  } catch {
    return true
  }
}
