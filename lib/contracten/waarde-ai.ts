import 'server-only'
import type { Onderdeel } from './waarde-voorstel'

// Contractwaarde uit een contract-pdf lezen (Claude, document-block).
// Een SUGGESTIE: de AI geeft de onderdelen (bedrag × aantal) met het citaat;
// de som rekenen we zelf na (waardeUitOnderdelen). Niets wordt bewaard als
// contractwaarde zonder bevestiging van een mens.

const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'

export type AiWaarde = { onderdelen: (Onderdeel & { citaat: string | null })[]; totaal: number | null; zekerheid: number | null; opmerking: string | null }

export async function leesContractwaarde(base64Pdf: string): Promise<AiWaarde> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')
  const prompt = `Bepaal de totale contractwaarde excl. btw van dit contract: wat de klant over de volledige (minimale) looptijd betaalt.
Redeneer zoals een boekhouder: een bedrag per maand × het aantal maanden van de looptijd, per kwartaal × het aantal kwartalen, eenmalige bedragen één keer.
Voorbeeld: "contract van 3 maanden aan € 500 per maand" → één onderdeel { bedrag_excl: 500, aantal: 3, eenheid: "maand" } = € 1.500.

Geef UITSLUITEND geldige JSON:
{
  "onderdelen": [
    { "omschrijving": "Social media management", "bedrag_excl": 500, "aantal": 3, "eenheid": "maand", "citaat": "…" },
    { "omschrijving": "Opstartkost", "bedrag_excl": 750, "aantal": 1, "eenheid": "keer", "citaat": "…" }
  ],
  "totaal_excl": 2250,
  "zekerheid": 0.9,
  "opmerking": null
}
Regels:
- Enkel bedragen die letterlijk in het contract staan; nooit gokken. Niets gevonden → "onderdelen": [] en een korte "opmerking".
- eenheid ∈ maand | kwartaal | jaar | keer.
- Staat er enkel een bedrag incl. btw, reken om naar excl. (÷ 1,21) en zeg dat in "opmerking".
- Onbepaalde duur zonder minimale looptijd: tel niets mee voor dat terugkerende bedrag en zeg het in "opmerking".
- Variabele kosten, advertentiebudget of opties die niet zeker zijn: niet meetellen, wel kort vermelden in "opmerking".
- citaat = de letterlijke zinsnede (max 200 tekens). opmerking = max 2 korte zinnen in het Nederlands, of null.`
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 1500, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } }, { type: 'text', text: prompt }] }] }),
    })
  } catch (e) { throw new Error(`Kan de AI-dienst niet bereiken: ${e instanceof Error ? e.message : 'netwerkfout'}`) }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`AI-fout (model ${MODEL()}): ${json?.error?.message || `HTTP ${res.status}`}`)
  const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  const a = text.indexOf('{'), z = text.lastIndexOf('}')
  if (a === -1 || z === -1) throw new Error('AI gaf geen bruikbaar antwoord terug.')
  let p: Record<string, unknown>
  try { p = JSON.parse(text.slice(a, z + 1)) } catch { throw new Error('AI-antwoord kon niet als JSON gelezen worden.') }
  const getal = (v: unknown) => { const n = Number(String(v ?? '').replace(',', '.')); return Number.isFinite(n) ? n : NaN }
  const onderdelen = (Array.isArray(p.onderdelen) ? p.onderdelen : []).slice(0, 12).map((o) => {
    const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
    return {
      omschrijving: String(r.omschrijving ?? '').slice(0, 120), bedrag_excl: getal(r.bedrag_excl), aantal: getal(r.aantal),
      eenheid: typeof r.eenheid === 'string' ? r.eenheid : null, citaat: typeof r.citaat === 'string' ? r.citaat.slice(0, 300) : null,
    }
  }).filter((o) => Number.isFinite(o.bedrag_excl) && Number.isFinite(o.aantal))
  const totaal = getal(p.totaal_excl), zekerheid = getal(p.zekerheid)
  return {
    onderdelen, totaal: Number.isFinite(totaal) ? totaal : null,
    zekerheid: Number.isFinite(zekerheid) ? Math.max(0, Math.min(1, zekerheid)) : null,
    opmerking: typeof p.opmerking === 'string' && p.opmerking.trim() ? p.opmerking.trim().slice(0, 300) : null,
  }
}
