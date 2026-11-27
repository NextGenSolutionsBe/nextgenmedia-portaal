import 'server-only'
import { boom, leesAcVoorstel, type AcVoorstel, type Map } from './model'

// De gegevens van een algemeen contract uit de PDF lezen, met Claude.
// Enkel een voorstel: het scherm vult er lege velden mee in, niets wordt bewaard
// tot iemand op Opladen klikt.

const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'

export async function leesContractPdf(pdfBase64: string, mappen: Map[], vandaag: string): Promise<AcVoorstel> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')
  const mapLijst = boom(mappen).map((x) => `- ${x.pad}`).join('\n') || '(geen mappen)'
  const prompt = `Dit is een document dat NextGen Agency BV (handelsnamen NextGenMedia en NextGenSolutions, Hasselt) wil bewaren: een contract, volmacht, verklaring, polis, huurovereenkomst, NDA … Vandaag is ${vandaag}.
De zaakvoerders die namens NextGen Agency BV kunnen tekenen: Marco Castermans (Marco), Bram Reinquin (Bram), Chiara Walmagh (Chiara).

Lees het document en geef UITSLUITEND geldige JSON met deze velden:
{
  "titel": "korte, duidelijke titel zoals een mens ze in een lijst zet, bv. \\"Volmacht Carmans Accountants\\" of \\"Huurovereenkomst kantoor Corda Campus\\"",
  "map": "de best passende map, exact zoals in de lijst hieronder, of null",
  "tegenpartij": "de andere partij (bedrijf of persoon), nooit NextGen Agency, NextGenMedia of NextGenSolutions zelf; null als er geen is",
  "tegenpartij_email": "e-mailadres van de andere partij als het in het document staat, anders null",
  "begin_datum": "YYYY-MM-DD: begindatum, ingangsdatum of datum van opmaak; null als er geen staat",
  "eind_datum": "YYYY-MM-DD: einddatum of vervaldatum als die er staat; null bij onbepaalde duur",
  "labels": ["hoogstens 3 korte trefwoorden, bv. \\"volmacht\\", \\"btw\\", \\"kantoor\\""],
  "ons_nodig": true of false: moet NextGen Agency BV (een van de zaakvoerders) dit ondertekenen?,
  "ons_tekenaars": ["wie van Marco, Bram en Chiara als ondertekenaar voor NextGen Agency BV in het document staat, bv. bij \\"Ondergetekende\\" of onder de handtekeningen"],
  "partij_nodig": true of false: moet de andere partij ook tekenen?,
  "notitie": "één of twee zinnen met wat later belangrijk is (opzegtermijn, verlenging, bedrag, waarvoor de volmacht dient); null als er niets bijzonders is"
}

Mappen:
${mapLijst}

Verzin niets: wat niet in het document staat, wordt null of een lege lijst.`
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL(), max_tokens: 900,
        messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } }, { type: 'text', text: prompt }] }],
      }),
    })
  } catch (e) { throw new Error(`Kan de AI-dienst niet bereiken: ${e instanceof Error ? e.message : 'netwerkfout'}`) }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`AI-fout: ${json?.error?.message || `HTTP ${res.status}`}`)
  const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  return leesAcVoorstel(text, mappen)
}
