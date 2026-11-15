import 'server-only'
import type { PlanPost } from '@/lib/facturatie/contract-plan'
import type { Frequentie } from '@/lib/facturatie/factuurvoorstellen'

// Het facturatieplan uit een contract-pdf lezen (Claude, document-block).
// Per post: wat (naam voor op de factuur), hoe vaak, hoeveel, vanaf wanneer,
// hoeveel keer en wat er inbegrepen is. De server legt dit naast de gegevens
// die het team in de app invulde (die gaan voor) en rekent zelf de facturen uit.

const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'
const FREQ: Frequentie[] = ['eenmalig', 'maandelijks', 'tweemaandelijks', 'kwartaal', 'halfjaarlijks', 'jaarlijks']

export type AiPlan = { posten: (PlanPost & { citaat: string | null })[]; btwPct: number | null; moment: 'eerste' | 'laatste' | null; opmerking: string | null; analyse: string | null }

export async function leesFacturatieplan(base64Pdf: string): Promise<AiPlan> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')
  const prompt = `Je bent de boekhouder van een Belgisch marketingbureau (NextGenMedia / NextGenSolutions). Lees dit contract volledig, ook prijstabellen, bijlagen, betalingsvoorwaarden en kleine lettertjes, en bepaal precies welke facturen we de klant moeten sturen, wanneer en voor hoeveel.

Werkwijze:
1. Zoek alle bedragen en wat ze dekken: maandbedragen, kwartaal- of jaarbedragen, eenmalige bedragen, opstartkosten, voorschotten, saldo's, hosting, onderhoud, licenties.
2. Zoek de betalingsafspraken: wanneer wordt er gefactureerd (bij ondertekening, bij de start, bij oplevering, maandelijks vooraf of achteraf), hoe lang loopt het contract, vanaf wanneer.
3. Maak per factuurreeks één post.

Geef UITSLUITEND geldige JSON:
{
  "analyse": "Maandelijks € 979 voor sociale media van januari tot en met juni 2027, vooraf te factureren. Daarnaast een opstartkost van € 500 bij ondertekening.",
  "posten": [
    {
      "naam": "Sociale media management",
      "soort": "terugkerend",
      "frequentie": "maandelijks",
      "bedrag_excl": 979,
      "aantal_perioden": 6,
      "start": "2027-01-01",
      "inbegrepen": ["contentplanning", "creatie en publicatie van berichten", "beheer van de afgesproken sociale mediakanalen"],
      "omschrijving": "Socialmediadiensten conform overeenkomst voor de periode [periode], inclusief contentplanning, creatie en publicatie van berichten en beheer van de afgesproken sociale mediakanalen.",
      "citaat": "…"
    },
    { "naam": "Opstartkost sociale media", "soort": "eenmalig", "frequentie": "eenmalig", "bedrag_excl": 500, "aantal_perioden": 1, "start": null, "inbegrepen": ["strategie en opmaak van de contentlijnen"], "omschrijving": "Eenmalige opstartkost conform overeenkomst, inclusief de strategie en de opmaak van de contentlijnen.", "citaat": "…" },
    { "naam": "Hosting", "soort": "terugkerend", "frequentie": "jaarlijks", "bedrag_excl": 240, "aantal_perioden": 1, "start": "2027-01-01", "inbegrepen": ["hosting", "SSL-certificaat"], "omschrijving": "Hosting van de website conform overeenkomst voor de periode [periode], inclusief SSL-certificaat en back-ups.", "citaat": "…" }
  ],
  "btw_pct": 21,
  "facturatiemoment": "eerste",
  "opmerking": null
}

Regels:
- analyse: 1 tot 3 korte zinnen: wat het contract zegt over prijzen, looptijd en wanneer er gefactureerd wordt.
- naam: korte, duidelijke titel van wat we leveren (max 6 woorden), zoals op een factuur, zo specifiek als het contract toelaat (geen klantnaam, geen periode, geen bedrag). Bv. "Sociale media management", "Ontwerp infopanelen", "Website", "Hosting", "Onderhoudscontract website", "Bedrijfsvideo".
- omschrijving: één duidelijke, zakelijke zin voor op de factuur, in de stijl van het voorbeeld: wat de klant krijgt, "conform overeenkomst", en bij een terugkerende post letterlijk "voor de periode [periode]" (de app vult de maand, het kwartaal of het jaar in). Geen bedragen, geen datums, geen klantnaam. Elke factuur van dezelfde post krijgt zo exact dezelfde titel en omschrijving, enkel de periode verschilt.
- soort ∈ terugkerend | eenmalig. frequentie ∈ eenmalig | maandelijks | tweemaandelijks | kwartaal | halfjaarlijks | jaarlijks.
- Hosting, onderhoud, licenties of een onderhoudscontract zijn altijd een aparte post met hun eigen frequentie en startdatum.
- Voorschot: altijd een aparte eenmalige post ("Voorschot website (50%)"), met als start de datum van ondertekening of de datum die het contract noemt (onbekend: null). Het saldo ook apart ("Saldo website (50%)"), met als start de opleverdatum als die er staat (anders null). Gaat het voorschot af van latere facturen, zeg dat in "opmerking".
- Facturatie in schijven van een eenmalig totaal (bv. 30% / 40% / 30%): per schijf een eenmalige post met dat bedrag en de naam van de schijf.
- bedrag_excl = bedrag excl. btw per factuur (eenmalig: het bedrag van die factuur). Staat er enkel incl. btw, reken om (÷ 1,21) en zeg het in "opmerking". Reken percentages zelf uit (50% van € 3.000 = 1500).
- aantal_perioden = hoeveel facturen van die post (januari tot en met juni maandelijks = 6; 1 jaar per kwartaal = 4). Onbepaalde duur zonder minimum: null.
- start = eerste dag van de eerste periode van die post (JJJJ-MM-DD), NIET de ondertekendatum, tenzij het contract zegt dat er bij ondertekening gefactureerd wordt. Niet vermeld: null.
- inbegrepen = wat het contract concreet opsomt voor die post (max 8, kort, kleine letters, zonder bedragen). Niets vermeld: [].
- Variabel advertentiebudget, commissies of opties die niet zeker zijn: geen post, wel kort in "opmerking".
- btw_pct enkel als het contract het noemt, anders null. facturatiemoment: eerste (begin van de periode, vooraf) | laatste (einde, achteraf) | null.
- Nooit gokken: wat niet in het contract staat is null.
- citaat = de letterlijke zinsnede uit het contract (max 200 tekens). opmerking = max 2 korte zinnen of null.`
  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 4000, messages: [{ role: 'user', content: [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Pdf } }, { type: 'text', text: prompt }] }] }),
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
  const posten = (Array.isArray(p.posten) ? p.posten : []).slice(0, 10).map((o) => {
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
      omschrijving: typeof r.omschrijving === 'string' && r.omschrijving.trim() ? r.omschrijving.replace(/\s+/g, ' ').trim().slice(0, 400) : null,
    }
  }).filter((x) => x.naam || x.bedrag)
  const btw = getal(p.btw_pct)
  return {
    posten, btwPct: btw !== null && btw >= 0 && btw <= 100 ? btw : null,
    moment: p.facturatiemoment === 'laatste' ? 'laatste' : p.facturatiemoment === 'eerste' ? 'eerste' : null,
    opmerking: typeof p.opmerking === 'string' && p.opmerking.trim() ? p.opmerking.trim().slice(0, 300) : null,
    analyse: typeof p.analyse === 'string' && p.analyse.trim() ? p.analyse.replace(/\s+/g, ' ').trim().slice(0, 400) : null,
  }
}
