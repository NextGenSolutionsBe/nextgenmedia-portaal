import 'server-only'
import { leesRapportVoorstel, type ProcesVoorstel } from './audit'

/**
 * Een eerste versie van het auditrapport uit de auditnotities en de briefing:
 * de processen, wie ze aanraakt met de uren per week, en de oplossing. Enkel
 * een voorstel; een mens neemt over en past aan. Naar de AI gaan enkel de
 * notities, de briefing en de klantnaam. Nooit prijzen of maten: die rekent de app.
 */
const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'

function vraag(o: { notities: string; briefing: string; klant: string | null }): string {
  return `Je helpt NextGenSolutions, een Belgisch bureau dat AI-automatisaties en software op maat bouwt voor kmo's.
Hieronder staan de notities van een auditdag${o.klant ? ` bij ${o.klant}` : ''}, en eventueel de briefing aan de bouwer.
Maak er een eerste versie van het auditrapport van: de processen die we zagen.

Regels:
- Per proces: een korte naam, wie het aanraakt (een functie of naam) met de uren per week zoals in de notities, en in twee of drie zinnen de oplossing die we voorstellen.
- Neem enkel uren over die in de notities staan. Staat er geen aantal, zet dan 0: wij meten het na.
- Verzin geen systemen, cijfers of afspraken. Geen prijzen.
- Een oplossing heeft altijd een interface of minstens een logboek; noem het.
- Schrijf in het Nederlands, kort en concreet.

Geef UITSLUITEND geldige JSON:
{"processen": [{"naam": "", "betrokkenen": [{"naam": "", "uren": 0}], "oplossing": ""}]}

Notities van de auditdag:
${o.notities.slice(0, 30000)}
${o.briefing ? `\nBriefing aan de bouwer:\n${o.briefing.slice(0, 10000)}` : ''}`
}

export async function voorstelRapport(o: { notities: string; briefing: string; klant: string | null }): Promise<ProcesVoorstel[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')
  if (o.notities.replace(/\s/g, '').length < 40) throw new Error('Schrijf eerst de notities van de auditdag.')
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 4000, messages: [{ role: 'user', content: vraag(o) }] }),
    })
  } catch (e) { throw new Error(`Kan de AI-dienst niet bereiken: ${e instanceof Error ? e.message : 'netwerkfout'}`) }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`AI-fout (model ${MODEL()}): ${json?.error?.message || `HTTP ${res.status}`}`)
  const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  const v = leesRapportVoorstel(text)
  if (!v || !v.length) throw new Error('De AI gaf geen bruikbaar voorstel terug. Probeer opnieuw of vul het zelf in.')
  return v
}
