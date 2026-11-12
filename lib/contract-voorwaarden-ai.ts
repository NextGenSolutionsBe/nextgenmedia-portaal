import 'server-only'

// Facturatieafspraken uit een contract-PDF lezen (Claude, document-block).
// AI is een hulpmiddel: het resultaat zijn SUGGESTIES met het citaat uit het
// contract. Niets wordt stil ingevuld of aangemaakt; de mens bevestigt elk veld.

const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'

export type Suggestie<T> = { waarde: T | null; citaat: string | null; zekerheid: number | null }
export type Voorwaarden = {
  dienst: Suggestie<string>
  start_dienstverlening: Suggestie<string>
  duur_maanden: Suggestie<number>
  frequentie: Suggestie<string>
  bedrag_per_periode_excl: Suggestie<number>
  btw_pct: Suggestie<number>
  facturatiemoment: Suggestie<string>
  inbegrepen_prestaties: string[]
}

const leeg = <T,>(): Suggestie<T> => ({ waarde: null, citaat: null, zekerheid: null })

function sug<T>(raw: unknown, soort: 'tekst' | 'getal' | 'datum'): Suggestie<T> {
  if (!raw || typeof raw !== 'object') return leeg<T>()
  const r = raw as Record<string, unknown>
  let w: unknown = r.waarde ?? null
  if (soort === 'getal') { const n = Number(String(w ?? '').replace(',', '.')); w = w === null || w === '' || !Number.isFinite(n) ? null : n }
  if (soort === 'datum') w = typeof w === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(w) ? w : null
  if (soort === 'tekst') w = typeof w === 'string' && w.trim() ? w.trim().slice(0, 200) : null
  const z = Number(r.zekerheid)
  return { waarde: w as T | null, citaat: typeof r.citaat === 'string' ? r.citaat.slice(0, 400) : null, zekerheid: Number.isFinite(z) ? Math.max(0, Math.min(1, z)) : null }
}

export async function leesVoorwaarden(base64Pdf: string): Promise<Voorwaarden> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')
  const prompt = `Lees dit contract en haal ENKEL de facturatieafspraken eruit die er letterlijk in staan.
Geef UITSLUITEND geldige JSON met deze structuur (waarde null als het niet in het contract staat — nooit gokken):
{
  "dienst": { "waarde": "Socialmediabeheer", "citaat": "…", "zekerheid": 0.9 },
  "start_dienstverlening": { "waarde": "2026-11-01", "citaat": "…", "zekerheid": 0.8 },
  "duur_maanden": { "waarde": 6, "citaat": "…", "zekerheid": 0.9 },
  "frequentie": { "waarde": "maandelijks", "citaat": "…", "zekerheid": 0.9 },
  "bedrag_per_periode_excl": { "waarde": 979, "citaat": "…", "zekerheid": 0.9 },
  "btw_pct": { "waarde": 21, "citaat": "…", "zekerheid": 0.7 },
  "facturatiemoment": { "waarde": "eerste", "citaat": "…", "zekerheid": 0.8 },
  "inbegrepen_prestaties": ["…"]
}
Regels:
- frequentie ∈ eenmalig | maandelijks | tweemaandelijks | kwartaal | halfjaarlijks | jaarlijks
- facturatiemoment ∈ eerste (eerste dag van de periode) | laatste (laatste dag) | start (dag van de start) | null
- start_dienstverlening = de start van de DIENSTVERLENING (JJJJ-MM-DD), NIET de ondertekendatum.
- bedrag_per_periode_excl = bedrag excl. btw per factuurperiode (bij eenmalig: het totaal). Staat er enkel een bedrag incl. btw, zet waarde null en vermeld het citaat.
- btw_pct enkel als het contract het noemt.
- citaat = de letterlijke zinsnede uit het contract (max 200 tekens).
- inbegrepen_prestaties = enkel prestaties die het contract concreet opsomt (max 8, kort).`
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 2000, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } }, { type: 'text', text: prompt }] }] }),
    })
  } catch (e) { throw new Error(`Kan de AI-dienst niet bereiken: ${e instanceof Error ? e.message : 'netwerkfout'}`) }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`AI-fout (model ${MODEL()}): ${json?.error?.message || `HTTP ${res.status}`}`)
  const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  const a = text.indexOf('{'), z = text.lastIndexOf('}')
  if (a === -1 || z === -1) throw new Error('AI gaf geen bruikbaar antwoord terug.')
  let p: Record<string, unknown>
  try { p = JSON.parse(text.slice(a, z + 1)) } catch { throw new Error('AI-antwoord kon niet als JSON gelezen worden.') }
  return {
    dienst: sug<string>(p.dienst, 'tekst'), start_dienstverlening: sug<string>(p.start_dienstverlening, 'datum'), duur_maanden: sug<number>(p.duur_maanden, 'getal'),
    frequentie: sug<string>(p.frequentie, 'tekst'), bedrag_per_periode_excl: sug<number>(p.bedrag_per_periode_excl, 'getal'), btw_pct: sug<number>(p.btw_pct, 'getal'),
    facturatiemoment: sug<string>(p.facturatiemoment, 'tekst'),
    inbegrepen_prestaties: Array.isArray(p.inbegrepen_prestaties) ? p.inbegrepen_prestaties.filter((x): x is string => typeof x === 'string').map((x) => x.slice(0, 120)).slice(0, 8) : [],
  }
}
