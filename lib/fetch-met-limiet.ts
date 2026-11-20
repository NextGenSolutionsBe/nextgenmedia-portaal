/**
 * fetch met een tijdslimiet.
 *
 * WAAROM — een gewone `fetch` wacht in principe eeuwig. Hangt Google, ClickUp
 * of Metricool, dan hangt de pagina die erop wacht mee, tot Vercel de functie
 * afkapt. Voor de bezoeker is dat niet te onderscheiden van "de app is stuk":
 * het blijft gewoon laden.
 *
 * Met een limiet krijg je in plaats daarvan snel een duidelijke fout, die de
 * oproeper netjes kan opvangen — de agenda toont dan bijvoorbeeld gewoon geen
 * Google-blokken in plaats van helemaal niet te laden.
 *
 * De standaard van 10 seconden is ruim voor een API die normaal in een paar
 * honderd milliseconden antwoordt. Voor iets wat lang mág duren (AI-generatie)
 * geef je zelf een hogere waarde mee.
 */
export const STANDAARD_LIMIET_MS = 10_000

export class TijdslimietFout extends Error {
  constructor(url: string, ms: number) {
    super(`Geen antwoord binnen ${Math.round(ms / 1000)} seconden van ${veiligeNaam(url)}.`)
    this.name = 'TijdslimietFout'
  }
}

/** Enkel host + pad in de foutmelding: querystrings kunnen sleutels bevatten. */
function veiligeNaam(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname}`
  } catch {
    return 'de externe dienst'
  }
}

export async function fetchMetLimiet(
  url: string,
  init?: RequestInit,
  ms: number = STANDAARD_LIMIET_MS,
): Promise<Response> {
  // Een eigen controller, zodat we ook een `signal` van de oproeper kunnen
  // eerbiedigen zonder die te overschrijven.
  const controle = new AbortController()
  const klok = setTimeout(() => controle.abort(), ms)
  const extern = init?.signal
  const stop = () => controle.abort()
  extern?.addEventListener('abort', stop)

  try {
    return await fetch(url, { ...init, signal: controle.signal })
  } catch (err) {
    // Onderscheid maken tussen "wij kapten af" en een echte netwerkfout, zodat
    // de oproeper een begrijpelijke melding kan tonen.
    if (controle.signal.aborted && !extern?.aborted) throw new TijdslimietFout(url, ms)
    throw err
  } finally {
    clearTimeout(klok)
    extern?.removeEventListener('abort', stop)
  }
}
