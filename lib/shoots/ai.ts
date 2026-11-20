import 'server-only'
import { naarVoorstel, type ShootPlan, type ShootVoorstel } from './model'

// Een briefing (tekst, pdf of foto) omzetten naar een shootplan. Enkel een
// voorstel: het scherm vult de velden in, een mens kijkt na en bewaart.

const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'
export const BEELD = ['image/jpeg', 'image/png', 'image/webp']
export const kanLezen = (mime: string | null | undefined) => mime === 'application/pdf' || BEELD.includes(String(mime))

function vraag(o: { tekst: string; klant: string | null; datum: string | null; vandaag: string; team: string[] }): string {
  return `Je maakt een shootplan voor NextGenMedia, een Belgisch marketingbureau dat foto- en videoshoots doet voor klanten.
Hieronder staat de briefing van een shoot${o.klant ? ` voor de klant ${o.klant}` : ''}. Haal eruit wat er gaat gebeuren: waar, hoe laat, wie, wat.
Vandaag is het ${o.vandaag}.${o.datum ? ` De shoot staat al ingepland op ${o.datum}; neem een andere datum enkel als de briefing er duidelijk een noemt.` : ''}${o.team.length ? `\nOns team: ${o.team.join(', ')}.` : ''}

Regels:
- Neem enkel over wat in de briefing staat. Verzin geen adressen, uren, namen, e-mailadressen of telefoonnummers.
- Een hele dag op meerdere plaatsen = meerdere programmapunten, elk met het uur en de locatie (bv. 11:00 op locatie A, 12:30 op locatie B). Reistijd, opbouw, pauze en afbreken mogen een eigen punt zijn als de briefing ze noemt.
- "locatie" in een programmapunt is exact de naam van een locatie uit "locaties".
- Uren als HH:MM (24 uur). Datum als JJJJ-MM-DD.
- Schrijf in het Nederlands, kort en concreet, zoals op een draaiboek.
- Wat je niet zeker weet of wat ontbreekt (geen adres, geen uur, onduidelijk wie): zet het kort in "onduidelijk".

Geef UITSLUITEND geldige JSON in deze vorm:
{
  "titel": "korte titel, bv. Bedrijfsvideo Bakkerij Peeters",
  "datum": "2026-11-28" of null,
  "doel": "één of twee zinnen: waarover gaat de shoot en wat moet er klaar zijn",
  "locaties": [{"naam": "Winkel Hasselt", "adres": "straat nr, postcode gemeente", "contact": "naam ter plaatse", "telefoon": "", "notitie": "parkeren, toegang, sleutel …"}],
  "programma": [{"van": "11:00", "tot": "12:00", "locatie": "Winkel Hasselt", "wat": "wat er gebeurt", "wie": "wie erbij moet zijn"}],
  "betrokkenen": [{"naam": "", "rol": "fotograaf, klant, model, …", "email": "", "telefoon": ""}],
  "paklijst": ["wat mee moet"],
  "shotlist": ["welke beelden of shots"],
  "praktisch": "dresscode, catering, weer, andere afspraken",
  "onduidelijk": ["wat nog ontbreekt of niet duidelijk is"]
}

Briefing:
${o.tekst.slice(0, 30000) || '(zie het document)'}`
}

export async function planUitBriefing(o: {
  tekst: string
  bestand?: { base64: string; mime: string } | null
  klant: string | null
  basis: Partial<ShootPlan>
  vandaag: string
  team: string[]
}): Promise<ShootVoorstel> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')
  if (!o.tekst.trim() && !o.bestand) throw new Error('Vul de briefing in of voeg een document toe.')
  const inhoud: unknown[] = []
  if (o.bestand && kanLezen(o.bestand.mime)) {
    inhoud.push(o.bestand.mime === 'application/pdf'
      ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: o.bestand.base64 } }
      : { type: 'image', source: { type: 'base64', media_type: o.bestand.mime, data: o.bestand.base64 } })
  }
  inhoud.push({ type: 'text', text: vraag({ tekst: o.tekst, klant: o.klant, datum: o.basis.datum || null, vandaag: o.vandaag, team: o.team }) })
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 4000, messages: [{ role: 'user', content: inhoud }] }),
    })
  } catch (e) { throw new Error(`Kan de AI-dienst niet bereiken: ${e instanceof Error ? e.message : 'netwerkfout'}`) }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`AI-fout (model ${MODEL()}): ${json?.error?.message || `HTTP ${res.status}`}`)
  const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  const v = naarVoorstel(text)
  if (!v) throw new Error('De AI gaf geen bruikbaar plan terug. Probeer opnieuw of vul het zelf in.')
  return v
}
