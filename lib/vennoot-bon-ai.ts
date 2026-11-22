import 'server-only'
import { leesBonVoorstel, type BonVoorstel } from '@/lib/vennoot-uitgaven'

// Een bonnetje of factuur van een uitgave van de vennoten lezen met Claude:
// wat het is, de datum en het totaal. Enkel een voorstel dat in het venster
// verschijnt; voor wie en waarvoor kiest de vennoot zelf, en pas Bewaren
// bewaart iets. Het nakijken van het antwoord staat in lib/vennoot-uitgaven.ts.

const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'
const BEELD = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export const kanBonLezen = (mime: string) => mime === 'application/pdf' || BEELD.includes(mime)

export async function leesBonnetje(base64: string, mime: string, vandaag: string): Promise<BonVoorstel> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')
  const bron = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } }
  const prompt = `Dit is een kassabonnetje, ticket of factuur van een aankoop (vandaag is het ${vandaag}).
Lees:
- winkel: de naam van de zaak of leverancier
- omschrijving: kort in het Nederlands wat er gekocht werd, met de zaak erbij (max. 10 woorden), bv. "Lunch bij Exki: 2 broodjes en 2 drankjes" of "Fiets bij Decathlon"
- datum: de datum van de aankoop als JJJJ-MM-DD (dag-maand-jaar op Belgische tickets)
- totaal: het totaal betaalde bedrag inclusief btw, als getal (bv. 23.40); niet het subtotaal of het btw-bedrag
- munt: EUR, USD …
- zekerheid: 0 tot 1, hoe zeker je bent van datum en totaal
Iets niet leesbaar: zet null. Verzin niets.
Geef UITSLUITEND geldige JSON: {"is_bon": true, "winkel": "Exki", "omschrijving": "Lunch bij Exki: 2 broodjes en 2 drankjes", "datum": "2026-11-18", "totaal": 23.40, "munt": "EUR", "zekerheid": 0.9}
Geen bonnetje of factuur: {"is_bon": false}`
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 400, messages: [{ role: 'user', content: [bron, { type: 'text', text: prompt }] }] }),
    })
  } catch (e) { throw new Error(`Kan de AI-dienst niet bereiken: ${e instanceof Error ? e.message : 'netwerkfout'}`) }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`AI-fout (model ${MODEL()}): ${json?.error?.message || `HTTP ${res.status}`}`)
  const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  return leesBonVoorstel(text, vandaag)
}
