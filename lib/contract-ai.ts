import 'server-only'

// AI-analyse van een contract-PDF via Anthropic Claude (document-block, REST).
// Detecteert invulvelden + handtekeningzone. AI is een hulpmiddel: de admin
// controleert/past het resultaat altijd aan vóór gebruik.

const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'

export const CONTRACT_FIELD_TYPES = ['text', 'email', 'phone', 'date', 'number', 'checkbox', 'signature'] as const
export type ContractFieldType = (typeof CONTRACT_FIELD_TYPES)[number]

export type ContractField = {
  label: string
  type: ContractFieldType
  page_number: number      // 1-indexed
  x: number                // % van links (0-100)
  y: number                // % van boven (0-100)
  width: number            // punten
  height: number           // punten
  required: boolean
  placeholder?: string
  confidence?: number      // 0-1; < 0.6 → "controle aanbevolen"
}

export type ContractAnalysis = {
  fields: ContractField[]
  signature: { page: number; x: number; y: number; width: number; height: number } | null
}

const VALID = new Set<string>(CONTRACT_FIELD_TYPES)

function coerceField(raw: Record<string, unknown>): ContractField | null {
  const label = String(raw.label ?? '').trim()
  let type = String(raw.type ?? 'text').toLowerCase()
  if (!VALID.has(type)) type = 'text'
  if (!label) return null
  const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d }
  const clampPct = (v: number) => Math.max(0, Math.min(100, v))
  const conf = num(raw.confidence, NaN)
  return {
    label, type: type as ContractFieldType,
    page_number: Math.max(1, Math.round(num(raw.page_number ?? raw.page, 1))),
    x: clampPct(num(raw.x, 5)), y: clampPct(num(raw.y, 50)),
    width: Math.max(20, num(raw.width, 180)), height: Math.max(12, num(raw.height, 24)),
    required: raw.required === undefined ? true : !!raw.required,
    placeholder: raw.placeholder ? String(raw.placeholder).slice(0, 120) : undefined,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : undefined,
  }
}

/**
 * Analyseert een PDF (base64) en geeft gedetecteerde velden + handtekeningzone.
 * Gooit een duidelijke fout bij ontbrekende key of AI-fout (geen stille fallback).
 */
export async function analyzeContractPdf(base64Pdf: string): Promise<ContractAnalysis> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')

  const prompt = `Je analyseert een contract-PDF om automatisch invulvelden en de handtekeningzone te detecteren EN exact te positioneren.

Geef UITSLUITEND geldige JSON terug met deze structuur:
{
  "fields": [
    { "label": "BTW-nummer", "type": "text", "page_number": 1, "x": 32, "y": 41.5, "width": 200, "height": 14, "required": true, "placeholder": "BE0123456789", "confidence": 0.9 }
  ],
  "signature": { "page": 1, "x": 10, "y": 80, "width": 200, "height": 60 }
}

POSITIONERING — gebruik meerdere ankers, niet alleen het labelwoord:
- Kijk naar (1) het label/de tekst, (2) de invullijn of het kader, (3) de witruimte waar getypt moet worden.
- Plaats x,y op het BEGIN van de witte invulzone (net na het label / op de lijn), NIET op het labelwoord zelf.
- y = de bovenkant van waar de ingevulde tekst hoort te staan, exact op de invullijn.
- Als een veld een ":" of een doorlopende lijn heeft, begint de invulzone net daarna.

Regels:
- type ∈ text | email | phone | date | number | checkbox | signature
- page_number is 1-geïndexeerd (eerste pagina = 1)
- x = percentage van links (0-100), y = percentage van boven (0-100); mag decimalen bevatten voor precisie
- width/height in punten (geschat op basis van de invulzone)
- "confidence" = 0..1: hoe zeker je bent van de POSITIE (1 = exact op de lijn herkend, < 0.6 = onzeker → mens controleert)
- Detecteer velden zoals: naam, bedrijfsnaam, e-mailadres, telefoonnummer, adres, btw-nummer, ondernemingsnummer, datum, functie, prijs, dienst, looptijd, startdatum.
- "signature" = de plek waar de klant moet ondertekenen (null als er geen is).
- Geef nooit een wilde gok als hoge confidence; bij twijfel een lage confidence i.p.v. een verkeerde positie.`

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL(), max_tokens: 4000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } },
            { type: 'text', text: prompt },
          ],
        }],
      }),
    })
  } catch (e) {
    throw new Error(`Kan de AI-dienst niet bereiken: ${e instanceof Error ? e.message : 'netwerkfout'}`)
  }

  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`AI-fout (model ${MODEL()}): ${json?.error?.message || `HTTP ${res.status}`}`)

  const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('AI gaf geen bruikbaar antwoord terug.')
  let parsed: { fields?: unknown[]; signature?: Record<string, unknown> | null }
  try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { throw new Error('AI-antwoord kon niet als JSON gelezen worden.') }

  const fields = Array.isArray(parsed.fields)
    ? parsed.fields.map((f) => coerceField(f as Record<string, unknown>)).filter((f): f is ContractField => f !== null).slice(0, 40)
    : []

  let signature: ContractAnalysis['signature'] = null
  const s = parsed.signature
  if (s && typeof s === 'object') {
    const num = (v: unknown, d: number) => { const n = Number(v); return Number.isFinite(n) ? n : d }
    signature = {
      page: Math.max(1, Math.round(num(s.page ?? s.page_number, 1))),
      x: Math.max(0, Math.min(100, num(s.x, 5))), y: Math.max(0, Math.min(100, num(s.y, 80))),
      width: Math.max(50, num(s.width, 200)), height: Math.max(30, num(s.height, 60)),
    }
  }
  return { fields, signature }
}
