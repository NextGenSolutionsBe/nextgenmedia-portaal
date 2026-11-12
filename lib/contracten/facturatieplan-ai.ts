import 'server-only'
import type { PlanPost } from '@/lib/facturatie/contract-plan'
import type { Frequentie } from '@/lib/facturatie/factuurvoorstellen'

// Het facturatieplan uit een contract-pdf lezen (Claude, document-block).
// Per post: wat (naam voor op de factuur), hoe vaak, hoeveel, vanaf wanneer,
// hoeveel keer en wat er inbegrepen is. De server legt dit naast de gegevens
// die het team in de app invulde (die gaan voor) en rekent zelf de facturen uit.

const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'
const FREQ: Frequentie[] = ['eenmalig', 'maandelijks', 'tweemaandelijks', 'kwartaal', 'halfjaarlijks', 'jaarlijks']

export type AiPlan = { posten: (PlanPost & { citaat: string | null })[]; btwPct: number | null; moment: 'eerste' | 'laatste' | null; opmerking: string | null }

export async function leesFacturatieplan(base64Pdf: string): Promise<AiPlan> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')
  const prompt = `Je bent boekhouder bij een Belgisch marketingbureau. Lees dit getekende contract en bepaal welke facturen we de klant moeten sturen.
Splits het contract in posten: een terugkerend bedrag (per maand, per kwartaal, per jaar …) en/of eenmalige bedragen (opstartkost, website, shoot).

Geef UITSLUITEND geldige JSON:
{
  "posten": [
    {
      "naam": "Sociale media management",
      "soort": "terugkerend",
      "frequentie": "maandelijks",
      "bedrag_excl": 979,
      "aantal_perioden": 6,
      "start": "2026-07-01",
      "inbegrepen": ["12 posts per maand op Instagram en Facebook", "Community management"],
      "citaat": "…"
    },
    { "naam": "Hosting", "soort": "terugkerend", "frequentie": "kwartaal", "bedrag_excl": 60, "aantal_perioden": 4, "start": "2027-01-01", "inbegrepen": ["Hosting en SSL"], "citaat": "…" },
    { "naam": "Website", "soort": "eenmalig", "frequentie": "eenmalig", "bedrag_excl": 2500, "aantal_perioden": 1, "start": "2026-11-15", "inbegrepen": ["Ontwerp en bouw van 5 pagina's"], "citaat": "…" }
  ],
  "btw_pct": 21,
  "facturatiemoment": "eerste",
  "opmerking": null
}
Regels:
- naam: kort, in het Nederlands, zoals op een factuur (geen klantnaam, geen periode). Bv. "Sociale media management", "Hosting", "Website", "Videoproductie".
- soort ∈ terugkerend | eenmalig. frequentie ∈ eenmalig | maandelijks | tweemaandelijks | kwartaal | halfjaarlijks | jaarlijks.
- bedrag_excl = bedrag excl. btw per factuur (eenmalig: het totaal van die post). Staat er enkel incl. btw, reken om (÷ 1,21) en zeg het in "opmerking".
- aantal_perioden = hoeveel facturen van die post (6 maanden maandelijks = 6; 1 jaar per kwartaal = 4). Onbepaalde duur zonder minimum: null.
- start = start van de dienstverlening van die post (JJJJ-MM-DD), NIET de ondertekendatum. Niet vermeld: null.
- inbegrepen = wat het contract concreet opsomt voor die post (max 8, kort, zonder bedragen). Niets vermeld: [].
- Facturatie in schijven van een eenmalig totaal (bv. 50% voorschot, 50% bij oplevering): maak per schijf een eenmalige post met dat bedrag ("Website, voorschot 50%").
- Variabel advertentiebudget, commissies of opties die niet zeker zijn: geen post, wel kort in "opmerking".
- btw_pct enkel als het contract het noemt, anders null. facturatiemoment: eerste (begin van de periode) | laatste (einde) | null.
- Nooit gokken: wat niet in het contract staat is null.
- citaat = de letterlijke zinsnede uit het contract (max 200 tekens). opmerking = max 2 korte zinnen of null.`
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 3000, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } }, { type: 'text', text: prompt }] }] }),
    })
  } catch (e) { throw new Error(`Kan de AI-dienst niet bereiken: ${e instanceof Error ? e.message : 'netwerkfout'}`) }
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`AI-fout (model ${MODEL()}): ${json?.error?.message || `HTTP ${res.status}`}`)
  const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  const a = text.indexOf('{'), z = text.lastIndexOf('}')
  if (a === -1 || z === -1) throw new Error('AI gaf geen bruikbaar antwoord terug.')
  let p: Record<string, unknown>
  try { p = JSON.parse(text.slice(a, z + 1)) } catch { throw new Error('AI-antwoord kon niet als JSON gelezen worden.') }
  const getal = (v: unknown) => { if (v === null || v === undefined || v === '') return null; const n = Number(String(v).replace(',', '.')); return Number.isFinite(n) ? n : null }
  const posten = (Array.isArray(p.posten) ? p.posten : []).slice(0, 8).map((o) => {
    const r = (o && typeof o === 'object' ? o : {}) as Record<string, unknown>
    const freq = FREQ.includes(r.frequentie as Frequentie) ? r.frequentie as Frequentie : null
    const soort: PlanPost['soort'] = r.soort === 'eenmalig' || freq === 'eenmalig' ? 'eenmalig' : 'terugkerend'
    const bedrag = getal(r.bedrag_excl), perioden = getal(r.aantal_perioden)
    return {
      naam: String(r.naam ?? '').replace(/\s+/g, ' ').trim().slice(0, 80), soort, frequentie: soort === 'eenmalig' ? 'eenmalig' as Frequentie : freq,
      bedrag: bedrag !== null && bedrag > 0 ? bedrag : null, perioden: perioden !== null && perioden > 0 ? Math.round(perioden) : null,
      start: typeof r.start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.start) ? r.start : null,
      inbegrepen: Array.isArray(r.inbegrepen) ? r.inbegrepen.filter((x): x is string => typeof x === 'string').map((x) => x.replace(/\s+/g, ' ').trim().slice(0, 140)).filter(Boolean).slice(0, 8) : [],
      citaat: typeof r.citaat === 'string' ? r.citaat.slice(0, 300) : null,
    }
  }).filter((x) => x.naam || x.bedrag)
  const btw = getal(p.btw_pct)
  return {
    posten, btwPct: btw !== null && btw >= 0 && btw <= 100 ? btw : null,
    moment: p.facturatiemoment === 'laatste' ? 'laatste' : p.facturatiemoment === 'eerste' ? 'eerste' : null,
    opmerking: typeof p.opmerking === 'string' && p.opmerking.trim() ? p.opmerking.trim().slice(0, 300) : null,
  }
}
