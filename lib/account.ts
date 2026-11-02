/** Mijn account: regels die zowel de browser als de server gebruiken. */

export const MIN_WACHTWOORD = 8

/** Versie van de profielfoto (stuk van het pad): verandert bij elke nieuwe foto, zodat de browser niet de oude toont. */
export function fotoVersie(u: { user_metadata?: Record<string, unknown> | null }): string | null {
  const pad = u.user_metadata?.avatar_pad
  if (typeof pad !== 'string' || !pad) return null
  return pad.split('/').pop()?.replace(/\.\w+$/, '').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40) || null
}

export function geldigEmail(e: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)
}

export function wachtwoordFout(w: string): string | null {
  if (w.length < MIN_WACHTWOORD) return `Een wachtwoord telt minstens ${MIN_WACHTWOORD} tekens.`
  if (w.length > 200) return 'Dat wachtwoord is te lang.'
  if (!/[a-zA-Z]/.test(w) || !/[0-9]/.test(w)) return 'Gebruik letters én cijfers.'
  return null
}
