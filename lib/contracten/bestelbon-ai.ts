import 'server-only'

// Het bestelbonnummer uit een bestelbon lezen (pdf of foto), met Claude.
// Enkel een voorstel met zekerheid: is het geen bestelbon of twijfelt de AI,
// dan gebeurt er niets en vult het team het nummer zelf in.

const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'
const BEELD = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

export type BestelbonLezing = { nummer: string | null; isBestelbon: boolean; zekerheid: number }

export const kanBestelbonLezen = (mime: string | null | undefined) => mime === 'application/pdf' || BEELD.includes(String(mime))

export async function leesBestelbonnummer(base64: string, mime: string): Promise<BestelbonLezing> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')
  if (!kanBestelbonLezen(mime)) throw new Error('Enkel een pdf of foto kan gelezen worden.')
  const bron = mime === 'application/pdf'
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } }
  const prompt = `Is dit document een bestelbon (ook: inkooporder, purchase order, PO, bon de commande) van een klant aan ons, NextGenMedia / NextGen Agency BV?
Zo ja: wat is het nummer van die bestelbon (het PO-nummer of bestelbonnummer dat de klant op onze factuur wil zien)? Neem het exact over, met letters, streepjes en spaties zoals het er staat. Geen factuurnummer, offertenummer, klantnummer of btw-nummer.
Geef UITSLUITEND geldige JSON: {"is_bestelbon": true, "nummer": "PO-2026-0815", "zekerheid": 0.95}
Geen nummer te vinden of geen bestelbon: {"is_bestelbon": false, "nummer": null, "zekerheid": 0}`
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 300, messages: [{ role: 'user', content: [bron, { type: 'text', text: prompt }] }] }),
    })
  } catch (e) { throw new Error(`Kan de AI-dienst niet bereiken: ${e instanceof Error ? e.message : 'netwerkfout'}`) }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`AI-fout (model ${MODEL()}): ${json?.error?.message || `HTTP ${res.status}`}`)
  const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  return leesAntwoord(text)
}

/** Het antwoord van de AI nakijken (los, zodat het getest kan worden). */
export function leesAntwoord(text: string): BestelbonLezing {
  const a = text.indexOf('{'), z = text.lastIndexOf('}')
  if (a === -1 || z === -1) return { nummer: null, isBestelbon: false, zekerheid: 0 }
  let p: Record<string, unknown>
  try { p = JSON.parse(text.slice(a, z + 1)) } catch { return { nummer: null, isBestelbon: false, zekerheid: 0 } }
  const nummer = typeof p.nummer === 'string' ? p.nummer.replace(/\s+/g, ' ').trim().slice(0, 60) : ''
  const zekerheid = Number(p.zekerheid)
  return { nummer: nummer || null, isBestelbon: p.is_bestelbon === true, zekerheid: Number.isFinite(zekerheid) ? Math.max(0, Math.min(1, zekerheid)) : 0 }
}

/** Overnemen als het een bestelbon is, er een nummer staat en de AI zeker genoeg is. */
export const bruikbaarNummer = (l: BestelbonLezing): string | null => (l.isBestelbon && l.nummer && l.zekerheid >= 0.6 ? l.nummer : null)
