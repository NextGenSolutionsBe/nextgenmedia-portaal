import 'server-only'

/**
 * Foutmeldingen die naar de browser gaan, filteren.
 *
 * Het probleem: `err.message` rechtstreeks terugsturen lekt interne details —
 * tabelnamen, kolomnamen, constraint-namen, PostgREST-codes. Dat is gratis
 * informatie voor iemand die de database in kaart wil brengen.
 *
 * De aanpak: BEDOELDE meldingen (die wij zelf schrijven, zoals "Titel is
 * verplicht") blijven gewoon zichtbaar — die helpen de gebruiker. Alles wat
 * eruitziet als een technische/database-fout wordt vervangen door een neutrale
 * tekst. De volledige fout gaat altijd naar de serverlog, zodat wij hem wél zien.
 */

// Signalen dat een melding uit de database of het framework komt.
const INTERNAL_MARKERS = [
  'relation ', 'column ', 'constraint', 'duplicate key', 'violates',
  'syntax error', 'invalid input', 'null value in', 'permission denied',
  'pgrst', 'postgres', 'supabase', 'jwt', 'schema cache', 'does not exist',
  'econnrefused', 'etimedout', 'fetch failed', 'at async', 'at object.',
]

const GENERIC = 'Er ging iets mis. Probeer het opnieuw of neem contact op als het blijft gebeuren.'

/** Ziet deze melding eruit als interne techniek i.p.v. iets voor de gebruiker? */
export function looksInternal(message: string): boolean {
  const m = message.toLowerCase()
  if (message.length > 200) return true          // stacktrace-achtig
  return INTERNAL_MARKERS.some((marker) => m.includes(marker))
}

/**
 * Veilige melding voor de gebruiker + volledige fout in de serverlog.
 * `context` maakt de logregel terugvindbaar (bv. 'clients.POST').
 */
export function safeMessage(err: unknown, context?: string): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  // Altijd volledig loggen — dit is de plek waar wij de details wél zien.
  console.error(`[api${context ? `:${context}` : ''}]`, err)
  if (!raw) return GENERIC
  return looksInternal(raw) ? GENERIC : raw
}
