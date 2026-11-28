import 'server-only'
import { BRIEFING_VELDEN, leesLeveringVoorstel, type Briefing, type BriefingVoorstel, type StoryVoorstel } from './levering'

/**
 * Uit de notities van de audit een voorstel maken: de briefing en de user
 * stories. Enkel een voorstel: het scherm toont het, een mens past aan en
 * bevestigt. Naar de AI gaan enkel de notities, de briefing en de klantnaam.
 */
const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'

function vraag(o: { notities: string; briefing: Briefing; klant: string | null }): string {
  const velden = BRIEFING_VELDEN.map((v) => `  "${v.key}": "${v.label}: ${v.hint}"`).join(',\n')
  const huidige = BRIEFING_VELDEN.filter((v) => o.briefing[v.key]).map((v) => `${v.label}: ${o.briefing[v.key]}`).join('\n')
  return `Je helpt NextGenSolutions, een Belgisch bureau dat AI-automatisaties en software op maat bouwt voor kmo's.
Hieronder staan de notities van een audit${o.klant ? ` bij de klant ${o.klant}` : ''}: een gesprek waarin we de processen van de klant doorliepen.
Maak er een voorstel van: een briefing en de user stories voor het project.

Regels:
- Neem enkel over wat in de notities of de huidige briefing staat. Verzin geen systemen, cijfers of afspraken.
- Een user story is klein genoeg om in hoogstens 16 uur te bouwen. Splits grotere stukken.
- Per user story: een korte titel, "als" (de gebruiker), "wil" (wat), "zodat" (waarom), 2 tot 5 toetsbare acceptatiecriteria en een schatting in uren (een getal, of null als je het echt niet kan inschatten).
- Schrijf in het Nederlands, kort en concreet, zoals mensen het zeggen.
- Velden van de briefing die je niet uit de notities kan halen: laat ze leeg ("").

Geef UITSLUITEND geldige JSON in deze vorm:
{
  "briefing": {
${velden}
  },
  "stories": [{"titel": "", "als": "", "wil": "", "zodat": "", "acceptatiecriteria": [""], "schatting_uren": 4}]
}
${huidige ? `\nDe briefing zoals ze nu is (vul aan, spreek niet tegen):\n${huidige}\n` : ''}
Notities van de audit:
${o.notities.slice(0, 30000)}`
}

export async function voorstelUitTijdscan(o: { notities: string; briefing: Briefing; klant: string | null }): Promise<{ briefing: BriefingVoorstel; stories: StoryVoorstel[] }> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')
  if (o.notities.replace(/[-\s:]/g, '').length < 40) throw new Error('Schrijf eerst de notities van de audit.')
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 6000, messages: [{ role: 'user', content: vraag(o) }] }),
    })
  } catch (e) { throw new Error(`Kan de AI-dienst niet bereiken: ${e instanceof Error ? e.message : 'netwerkfout'}`) }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`AI-fout (model ${MODEL()}): ${json?.error?.message || `HTTP ${res.status}`}`)
  const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  const v = leesLeveringVoorstel(text)
  if (!v) throw new Error('De AI gaf geen bruikbaar voorstel terug. Probeer opnieuw of vul het zelf in.')
  return v
}
