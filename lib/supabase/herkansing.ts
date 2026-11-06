/**
 * Eén databaselezing met één herkansing.
 *
 * WAAROM — Vercel bevriest een serverless-functie zodra ze geantwoord heeft,
 * mét de open verbinding naar Supabase. PostgREST kapt zo'n idle verbinding
 * na een tijdje af (in de logs: "Thread killed by timeout manager"). Wordt
 * diezelfde functie een minuut later hergebruikt, dan grijpt ze eerst naar die
 * dode socket, en de EERSTE lezing mislukt. supabase-js gooit dan niet, maar
 * geeft `{ data: null, error }` terug — en code die enkel naar `data` kijkt,
 * leest dat als "niets gevonden". Zo werd een geldig cron-geheim een 401, twee
 * actieve doelen "geen doelen", en een prima Google-koppeling "werkt niet".
 *
 * Eén herkansing volstaat: de tweede poging opent een verse verbinding.
 */

type Uitkomst<T> = { data: T | null; error: { message: string } | null }

export async function metHerkansing<T>(
  lezing: () => PromiseLike<Uitkomst<T>>,
  pauzeMs = 250,
): Promise<Uitkomst<T>> {
  let laatste: Uitkomst<T> = { data: null, error: { message: 'niet uitgevoerd' } }
  for (let poging = 0; poging < 2; poging++) {
    try {
      laatste = await lezing()
      if (!laatste.error) return laatste
    } catch (e) {
      laatste = { data: null, error: { message: e instanceof Error ? e.message : 'onbekende fout' } }
    }
    if (poging === 0) await new Promise((r) => setTimeout(r, pauzeMs))
  }
  return laatste
}

/** Foutmelding voor een lezing die ook na de herkansing niet lukte. */
export const DATABANK_TIJDELIJK = 'De databank reageert even niet (tijdelijk)'
