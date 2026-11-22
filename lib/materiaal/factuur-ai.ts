import 'server-only'
import { leesFactuurVoorstel, type FactuurVoorstel } from '@/lib/materiaal/factuur'

// Een aankoopfactuur van materiaal (camera, lens, licht …) lezen met Claude.
// Enkel een voorstel dat in het formulier verschijnt; bewaren doet iemand zelf.
// Nakijken van het antwoord: leesFactuurVoorstel (lib/materiaal/factuur.ts).

const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'
const BEELD = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export const kanFactuurLezen = (mime: string) => mime === 'application/pdf' || BEELD.includes(mime)

export async function leesMateriaalFactuur(base64: string, mime: string, categorieen: string[], vandaag: string): Promise<FactuurVoorstel> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')
  const bron = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } }
  const prompt = `Dit is een aankoopfactuur of kasticket van materiaal voor een videoproductie- en marketingbureau (vandaag is het ${vandaag}).
We registreren elk toestel in ons materiaalbeheer. Lees de factuur en geef per toestel alles wat we moeten weten.

Wat is een toestel: alles wat we apart bijhouden en uitlenen (camera, lens, microfoon, recorder, licht, gimbal, statief, drone, laptop, monitor, tas of koffer, geheugenkaart …).
Kleine onderdelen die met een toestel meegeleverd worden (batterij, lader, riem, kabel, lensdop, zonnekap, handleiding) horen bij "inhoud" van dat toestel, niet als apart toestel.
Geen toestel: verzendkosten, diensten, garantie-uitbreidingen, verzekering, recyclagebijdrage, kortingen.

Per toestel:
- naam: hoe we het noemen, kort en herkenbaar, bv. "Sony A7 IV" of "Sigma 24-70mm F2.8 DG DN Art (Sony E)"
- merk, model (het typenummer zoals op de factuur, bv. ILCE-7M4)
- serienummers: elk serienummer dat bij dit toestel op de factuur staat (lijst), anders []
- categorie: kies exact één van deze namen als ze past, anders null: ${categorieen.map((c) => `"${c}"`).join(', ')}
- aantal: hoeveel stuks
- prijs_excl en prijs_incl: prijs per stuk excl. en incl. btw zoals op de factuur (getallen, bv. 2149.59), null als ze er niet staan
- omschrijving: één of twee zinnen in het Nederlands wat het is en waarvoor we het gebruiken, bv. "Full-frame systeemcamera voor foto en 4K-video."
- inhoud: wat erbij geleverd wordt volgens de factuur (lijst), anders []
- kenmerken: de belangrijkste specificaties van dit model zoals algemeen bekend (max. 6 korte regels, bv. "33 MP full-frame sensor", "4K 60p, 10-bit"), enkel als je het model zeker kent, anders []

Voor de hele factuur:
- leverancier, factuurnummer, datum (JJJJ-MM-DD; dag-maand-jaar op Belgische facturen), btw (het percentage, bv. 21)
- garantie_tot (JJJJ-MM-DD) of garantie_maanden: enkel als de garantie op de factuur staat, anders null
- zekerheid: 0 tot 1

Iets niet leesbaar of er niet: null. Verzin geen serienummers, prijzen of datums.
Geef UITSLUITEND geldige JSON:
{"is_factuur": true, "leverancier": "Kamera Express", "factuurnummer": "F-2026-1188", "datum": "2026-11-14", "btw": 21, "garantie_tot": null, "garantie_maanden": 24, "zekerheid": 0.9,
 "toestellen": [{"naam": "Sony A7 IV", "merk": "Sony", "model": "ILCE-7M4", "serienummers": ["5123456"], "categorie": "Camera's", "aantal": 1, "prijs_excl": 2149.59, "prijs_incl": 2601.0, "omschrijving": "…", "inhoud": ["Batterij NP-FZ100", "Lader BC-QZ1"], "kenmerken": ["33 MP full-frame sensor"]}]}
Geen factuur of aankoopbewijs: {"is_factuur": false}`
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 3000, messages: [{ role: 'user', content: [bron, { type: 'text', text: prompt }] }] }),
    })
  } catch (e) { throw new Error(`Kan de AI-dienst niet bereiken: ${e instanceof Error ? e.message : 'netwerkfout'}`) }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`AI-fout (model ${MODEL()}): ${json?.error?.message || `HTTP ${res.status}`}`)
  const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  return leesFactuurVoorstel(text, categorieen, vandaag)
}
