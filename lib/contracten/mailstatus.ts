// Mailstatus van een contract — pure module (client-safe, getest in tests/contract-mailstatus.test.ts).
//
// Staat LOS van de ondertekenstatus: "Gemaild" betekent niet "Getekend".
// "Afgeleverd" enkel als de mailprovider dat effectief bevestigt.

export type MailStatus = 'niet' | 'bezig' | 'gemaild' | 'afgeleverd' | 'mislukt' | 'zonder_logboek'
export const MAIL_STATUS: Record<MailStatus, { label: string; cls: string; uitleg: string }> = {
  niet: { label: 'Nog niet gemaild', cls: 'bg-gray-50 text-gray-600 border-gray-200', uitleg: 'Er werd nog geen contractmail vanuit de app verstuurd.' },
  bezig: { label: 'Verzending bezig', cls: 'bg-blue-50 text-blue-800 border-blue-200', uitleg: 'De laatste verzendpoging loopt nog.' },
  gemaild: { label: 'Gemaild', cls: 'bg-green-50 text-green-800 border-green-200', uitleg: 'De mailprovider heeft de mail aanvaard. Dat betekent niet dat het contract getekend is.' },
  afgeleverd: { label: 'Afgeleverd', cls: 'bg-[#166534] text-white border-[#166534]', uitleg: 'De mailprovider bevestigt de aflevering bij de ontvanger.' },
  mislukt: { label: 'Verzending mislukt', cls: 'bg-red-50 text-red-800 border-red-300', uitleg: 'De laatste verzendpoging is mislukt — bekijk de foutmelding en verstuur opnieuw.' },
  zonder_logboek: { label: 'Verstuurd (geen mailgegevens)', cls: 'bg-gray-50 text-gray-700 border-gray-300', uitleg: 'Het contract staat als verstuurd, maar van die verzending zijn geen mailgegevens bewaard.' },
}

export type MailPoging = { status: string | null; created_at: string; provider_status?: string | null }

/** Zonder resultaat na zoveel minuten telt een poging "bezig" als mislukt. */
const BEZIG_MAX_MS = 15 * 60_000

export function mailStatusVan(pogingen: MailPoging[], sentAt: string | null | undefined, nu = Date.now()): MailStatus {
  if (!pogingen.length) return sentAt ? 'zonder_logboek' : 'niet'
  const laatste = [...pogingen].sort((a, b) => b.created_at.localeCompare(a.created_at))[0]
  const s = (laatste.status ?? '').toLowerCase()
  if (s === 'bezig') return nu - new Date(laatste.created_at).getTime() > BEZIG_MAX_MS ? 'mislukt' : 'bezig'
  if (s === 'error' || s === 'failed' || s === 'bounced') return 'mislukt'
  if (s === 'delivered' || (laatste.provider_status ?? '').toLowerCase() === 'delivered') return 'afgeleverd'
  if (['bounced', 'failed'].includes((laatste.provider_status ?? '').toLowerCase())) return 'mislukt'
  return 'gemaild'
}
