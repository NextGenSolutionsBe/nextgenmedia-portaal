/**
 * Sessiecontrole voor de tweede stap — edge-veilig (geen node:crypto), want de
 * middleware gebruikt dit. De bron is de tabel twofa_sessies: één rij per
 * Supabase-sessie (session_id uit de JWT) die de tweede stap doorliep. Dezelfde
 * rij gebruiken de middleware, de route-guards en de RLS (sessie_2fa_ok()).
 * Uitloggen of een securitywijziging wist de rij → meteen overal ongeldig.
 */

export const SESSIE_TTL_MS = 12 * 60 * 60 * 1000

export type SessieRij = { user_id: string; verloopt_op: string }

/** Heeft deze Supabase-sessie de tweede stap (app-code of herstelcode) doorlopen? */
export function sessieStatus(rij: SessieRij | null, userId: string, nuMs: number): 'ok' | 'nodig' {
  if (!rij || rij.user_id !== userId) return 'nodig'
  return Date.parse(rij.verloopt_op) > nuMs ? 'ok' : 'nodig'
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
 *  'door'        verder (tweede stap in orde, of door een admin vrijgesteld)
 *  'verificatie' naar /login/verify (app-code, of eerst een app koppelen) — 401 op een API
 * `verplicht` = twoFactorRequired() (enkel nodig als de status 'nodig' is).
 */
export function tweedeStapActie(status: 'ok' | 'nodig', verplicht: boolean): 'door' | 'verificatie' {
  return status === 'nodig' && verplicht ? 'verificatie' : 'door'
}
