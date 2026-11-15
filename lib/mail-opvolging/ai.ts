import 'server-only'
import type { AiSoort } from './regels'

// Een antwoord van een klant inschatten: akkoord, vraag, weigering, uitstel of
// iets anders, met één korte zin. Enkel het nieuwe deel van de mail (zonder
// geciteerde tekst, adressen of bijlagen) gaat naar de AI. Het resultaat is een
// voorstel: een mens beslist of de kaart verder gaat.

const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'
const SOORTEN: AiSoort[] = ['akkoord', 'vraag', 'weigering', 'uitstel', 'anders']

export async function schatAntwoordIn(p: { onderwerp: string | null; tekst: string; fase: string }): Promise<{ soort: AiSoort; samenvatting: string | null } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !p.tekst.trim()) return null
  const prompt = `Je helpt een Belgisch marketingbureau zijn projecten op te volgen. Hieronder staat het nieuwe deel van een mail van een klant of prospect. Het project staat in de fase "${p.fase}".
Onderwerp: ${(p.onderwerp ?? '').slice(0, 200)}
---
${p.tekst.slice(0, 1500)}
---
Geef UITSLUITEND geldige JSON: {"soort": "akkoord|vraag|weigering|uitstel|anders", "samenvatting": "max 120 tekens, Nederlands, zonder aanspreking"}
- akkoord: de klant gaat duidelijk akkoord met het voorstel, de offerte of het contract, of wil starten.
- vraag: de klant stelt een vraag of wil iets aangepast zien voor hij beslist.
- weigering: de klant zegt nee, kiest iemand anders of stopt.
- uitstel: de klant beslist later, heeft nu geen tijd of budget.
- anders: al de rest (dank, praktisch, automatisch antwoord, afwezigheid).
Twijfel = anders.`
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 200, messages: [{ role: 'user', content: prompt }] }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) return null
    const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
    const a = text.indexOf('{'), z = text.lastIndexOf('}')
    if (a < 0 || z < 0) return null
    const r = JSON.parse(text.slice(a, z + 1)) as { soort?: string; samenvatting?: string }
    const soort = SOORTEN.includes(r.soort as AiSoort) ? r.soort as AiSoort : 'anders'
    const samenvatting = typeof r.samenvatting === 'string' && r.samenvatting.trim() ? r.samenvatting.trim().slice(0, 160) : null
    return { soort, samenvatting }
  } catch { return null }
}
