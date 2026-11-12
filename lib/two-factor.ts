// Tweestapsverificatie voor INTERNE accounts (admin + werknemers).
// Klanten en partners loggen gewoon met e-mail + wachtwoord in.
//
// Sinds 27 sep 2026 enkel nog met een authenticator-app (lib/twofa/). Wie nog
// geen app heeft, koppelt er een meteen na het wachtwoord. Wie de stap doorliep,
// staat in twofa_sessies — per Supabase-sessie, zodat uitloggen of een
// securitywijziging het meteen intrekt. Edge-veilig (geen node:crypto).

/** Oud verificatiecookie (vóór twofa_sessies) — enkel nog om het te wissen. */
export const TWO_FA_COOKIE = 'ngm_2fa'

/** Is een vrijstelling (login_settings) op dit moment geldig? Pure regel, getest. */
export function vrijstellingGeldig(
  rij: { two_factor_required?: boolean | null; vrijgesteld_tot?: string | null } | null,
  nuMs: number = Date.now(),
): boolean {
  if (!rij || rij.two_factor_required !== false) return false
  if (!rij.vrijgesteld_tot) return true
  return Date.parse(rij.vrijgesteld_tot) > nuMs
}

/**
 * Moet dit account de tweede stap (authenticator-app) doen?
 *
 * Standaard JA. Enkel een admin kan dat voor iemand anders uitzetten — tijdelijk
 * (vrijgesteld_tot) of tot hij het weer aanzet — en dat vraagt het eigen
 * wachtwoord + de eigen app-code van die admin. Elke andere uitkomst — geen rij,
 * vervallen vrijstelling, tabel onbereikbaar — houdt de stap verplicht.
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
    const { data, error } = await db.from('login_settings')
      .select('two_factor_required, vrijgesteld_tot').eq('auth_user_id', userId).maybeSingle()
    if (error) return true
    return !vrijstellingGeldig(data as { two_factor_required?: boolean; vrijgesteld_tot?: string | null } | null)
  } catch {
    return true
  }
}
