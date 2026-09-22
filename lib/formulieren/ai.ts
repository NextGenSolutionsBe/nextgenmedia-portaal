import 'server-only'
import { normaliseerVelden, dienstLabel, VELD_TYPE_INFO, VELD_TYPES, MAX_VELDEN, type Veld } from './model'

// AI-voorstel voor een formulier via Anthropic Claude (REST, zoals lib/contract-ai.ts).
// AI STELT ENKEL VOOR: de builder toont het voorstel, de mens kiest vervangen of
// toevoegen en slaat daarna zelf op. Hier wordt niets bewaard.

const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'

export type FormulierVoorstel = { titel: string; beschrijving: string; velden: Veld[] }

const TYPES_UITLEG = VELD_TYPES.map((t) => `- "${t}": ${VELD_TYPE_INFO[t].label} — ${VELD_TYPE_INFO[t].uitleg}`).join('\n')

const SYSTEEM = `Je bent een ervaren intake- en formulierontwerper voor NextGenMedia, een Belgisch marketing- en creatief bureau (social media, websites, grafisch ontwerp en huisstijl, foto & video, Google Ads, marketingadvies).
Je ontwerpt heldere, vriendelijke formulieren in het Nederlands (Vlaams, je-vorm) die klanten zelf invullen.

Beschikbare veldtypes (gebruik EXACT deze waarden voor "type"):
${TYPES_UITLEG}

Geef UITSLUITEND één geldig JSON-object terug, zonder uitleg of markdown, met deze structuur:
{
  "titel": "Korte titel van het formulier",
  "beschrijving": "Eén à drie zinnen die de klant uitleggen waarom en hoe lang het invullen duurt.",
  "velden": [
    { "id": "bedrijfsnaam", "type": "kort", "label": "Bedrijfsnaam", "verplicht": true },
    { "id": "s_stijl", "type": "sectie", "label": "Stijl", "hulptekst": "Optionele toelichting" },
    { "id": "uitstraling", "type": "meerkeuze", "label": "Welke uitstraling zoek je?", "opties": ["Modern", "Klassiek"], "verplicht": true },
    { "id": "heeft_logo", "type": "jaNee", "label": "Heb je al een logo?" },
    { "id": "logo", "type": "bestand", "label": "Upload je logo", "max": 3, "voorwaarde": { "veld": "heeft_logo", "waarde": "ja" } },
    { "id": "score", "type": "schaal", "label": "Hoe tevreden ben je?", "min": 1, "max": 5, "minLabel": "Slecht", "maxLabel": "Top" },
    { "id": "kleuren", "type": "kleur", "label": "Kleuren die je graag ziet", "max": 5 }
  ]
}

Regels:
- "id": korte snake_case, uniek, enkel a-z, 0-9 en _.
- Optionele sleutels: "hulptekst", "placeholder", "verplicht" (standaard false), "opties" (verplicht voor keuze/meerkeuze/dropdown), "min"/"max", "minLabel"/"maxLabel", "voorwaarde".
- "voorwaarde" toont een veld enkel als een EERDER veld een bepaalde waarde heeft: { "veld": "<id van eerder veld>", "waarde": "<exacte optie, of ja/nee bij jaNee>" }.
- Groepeer met "sectie"-velden bij formulieren van meer dan ±8 vragen.
- Vraag altijd naar contactgegevens (naam, e-mail) tenzij de opdracht dat uitsluit.
- Maak enkel echt noodzakelijke velden verplicht. Houd het formulier to-the-point: meestal 8 tot 25 velden, nooit meer dan ${MAX_VELDEN}.
- Gebruik "kleur" voor kleurvoorkeuren, "bestand" voor logo's/voorbeelden/documenten, "datum" voor deadlines, "dropdown" voor budgetvorken.`

export async function genereerFormulier(invoer: { prompt: string; dienst: string; doel: string }): Promise<FormulierVoorstel> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')

  const opdracht = [
    `Dienst: ${dienstLabel(invoer.dienst)}`,
    ...(invoer.doel ? [`Doel van het formulier: ${invoer.doel}`] : []),
    '',
    'Beschrijving van wat het formulier moet doen:',
    invoer.prompt,
  ].join('\n')

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL(), max_tokens: 8000,
        system: SYSTEEM,
        messages: [{ role: 'user', content: opdracht }],
      }),
    })
  } catch (e) {
    throw new Error(`Kan de AI-dienst niet bereiken: ${e instanceof Error ? e.message : 'netwerkfout'}`)
  }

  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`AI-fout (model ${MODEL()}): ${json?.error?.message || `HTTP ${res.status}`}`)

  const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('AI gaf geen bruikbaar antwoord terug. Probeer het opnieuw of formuleer je vraag anders.')
  let parsed: { titel?: unknown; beschrijving?: unknown; velden?: unknown }
  try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { throw new Error('Het AI-antwoord kon niet gelezen worden. Probeer het opnieuw.') }

  const velden = normaliseerVelden(parsed.velden)
  if (velden.length === 0) throw new Error('AI stelde geen bruikbare velden voor. Beschrijf iets concreter wat je wil vragen.')
  return {
    titel: String(parsed.titel ?? '').trim().slice(0, 200),
    beschrijving: String(parsed.beschrijving ?? '').trim().slice(0, 2000),
    velden,
  }
}
