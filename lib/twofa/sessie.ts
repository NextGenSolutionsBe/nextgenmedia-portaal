/**
 * Sessiecontrole voor de tweede stap — edge-veilig (geen node:crypto), want de
 * middleware gebruikt dit. De bron is de tabel twofa_sessies: één rij per
 * Supabase-sessie (session_id uit de JWT) die de tweede stap doorliep. Dezelfde
 * rij gebruiken de middleware, de route-guards en de RLS (sessie_2fa_ok()).
 * Uitloggen of een securitywijziging wist de rij → meteen overal ongeldig.
 */

export const SESSIE_TTL_MS = 12 * 60 * 60 * 1000

export type SessieRij = { user_id: string; verloopt_op: string; totp_instellen?: boolean | null }

/**
 * Heeft deze Supabase-sessie de tweede stap doorlopen?
 *  'ok'        ja
 *  'instellen' ja (via mailcode), maar de rol vereist nog een authenticator-app
 *  'nodig'     nee → naar /login/verify (of 401 op een API)
 */
export function sessieStatus(rij: SessieRij | null, userId: string, nuMs: number): 'ok' | 'instellen' | 'nodig' {
  if (!rij || rij.user_id !== userId) return 'nodig'
  if (!(Date.parse(rij.verloopt_op) > nuMs)) return 'nodig'
  return rij.totp_instellen ? 'instellen' : 'ok'
}

/**
 * Moet deze rol verplicht een authenticator-app gebruiken? (Beleid in
 * app_settings 'twofa_beleid' = { app_verplicht: ['admin', 'medewerker'] }.)
 * Standaard: voor niemand verplicht — de mailcode blijft dan volstaan.
 */
export function appVerplichtVoor(rol: 'admin' | 'employee', beleid: unknown): boolean {
  const lijst = (beleid as { app_verplicht?: unknown } | null)?.app_verplicht
  if (!Array.isArray(lijst)) return false
  return lijst.includes(rol === 'admin' ? 'admin' : 'medewerker')
}

/** session_id uit een (al door Supabase gecontroleerde) access token, zonder te valideren. */
export function sessieIdUitToken(accessToken: string | null | undefined): string | null {
  const deel = accessToken?.split('.')[1]
  if (!deel) return null
  try {
    const json = JSON.parse(atob(deel.replace(/-/g, '+').replace(/_/g, '/')))
    return typeof json.session_id === 'string' ? json.session_id : null
  } catch {
    return null
  }
}

/**
 * Wat doet de middleware met een INTERN account op een beschermd pad?
 *  'door'        verder (tweede stap in orde, of vrijgesteld)
 *  'verificatie' naar /login/verify (pagina) of 401 (API)
 *  'instellen'   rol vereist een app die nog niet ingesteld is → /admin/account
 * `verplicht` = twoFactorRequired() (enkel nodig als status 'nodig' is).
 */
export function tweedeStapActie(status: 'ok' | 'instellen' | 'nodig', verplicht: boolean, pad: string): 'door' | 'verificatie' | 'instellen' {
  if (status === 'nodig') return verplicht ? 'verificatie' : 'door'
  if (status === 'instellen' && pad.startsWith('/admin') && !pad.startsWith('/admin/account')) return 'instellen'
  return 'door'
}
