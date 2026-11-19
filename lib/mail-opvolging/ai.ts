import 'server-only'
import type { AiSoort } from './regels'
import { naarOordeel, type ProjectOordeel } from './projecten'

// Een mail lezen met de AI. Enkel het nieuwe deel (zonder geciteerde tekst,
// adressen of bijlagen) gaat mee. Twee dingen komen terug, allebei voorstellen
// die een mens bevestigt:
//  · bij een antwoord van de klant: akkoord, vraag, weigering, uitstel of anders, met één korte zin;
//  · taken voor ons: wat wij beloofden of wat de klant ons vroeg, met een datum als die er staat.

const MODEL = () => process.env.BLOG_AI_MODEL || 'claude-sonnet-4-6'
const SOORTEN: AiSoort[] = ['akkoord', 'vraag', 'weigering', 'uitstel', 'anders']

export type MailTaakVoorstel = { wat: string; deadline: string | null; wie: 'wij' | 'klant'; citaat: string | null }
export type MailLezing = { soort: AiSoort | null; samenvatting: string | null; taken: MailTaakVoorstel[] }

export async function leesMailInhoud(p: { richting: 'in' | 'uit'; onderwerp: string | null; tekst: string; datum: string; klant: string | null; fase: string | null }): Promise<MailLezing | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !p.tekst.trim()) return null
  const dag = p.datum.slice(0, 10)
  const wieSchreef = p.richting === 'uit' ? 'iemand van ons team (NextGenMedia) aan de klant' : 'de klant aan ons (NextGenMedia)'
  const prompt = `Je helpt een Belgisch marketingbureau (NextGenMedia) niets te vergeten. Hieronder staat het nieuwe deel van een mail, geschreven door ${wieSchreef}${p.klant ? ` (klant: ${p.klant.slice(0, 80)})` : ''}, verstuurd op ${dag}.${p.fase ? ` Het project staat in de fase "${p.fase}".` : ''}
Onderwerp: ${(p.onderwerp ?? '').slice(0, 200)}
---
${p.tekst.slice(0, 2500)}
---
Geef UITSLUITEND geldige JSON:
{
  "soort": ${p.richting === 'in' ? '"akkoord|vraag|weigering|uitstel|anders"' : 'null'},
  "samenvatting": ${p.richting === 'in' ? '"max 120 tekens, Nederlands, zonder aanspreking"' : 'null'},
  "taken": [ { "wat": "Voorstel social media sturen", "deadline": "2026-11-21", "wie": "wij", "citaat": "…" } ]
}
${p.richting === 'in' ? `soort: akkoord = gaat duidelijk akkoord of wil starten; vraag = stelt een vraag of wil iets aangepast; weigering = zegt nee of stopt; uitstel = beslist later; anders = al de rest. Twijfel = anders.\n` : ''}taken: enkel concrete dingen die NextGenMedia nog moet DOEN:
- ${p.richting === 'uit' ? 'wat wij in deze mail beloven ("ik stuur je vrijdag het voorstel", "we bellen je volgende week", "ik pas het logo aan tegen maandag") → wie = "wij"' : 'wat de klant ons vraagt te doen, of wanneer de klant zelf wil dat we opvolgen ("bel me na de vakantie", "kunnen jullie tegen 1 december de banners maken") → wie = "klant"'}.
- wat: kort en concreet, begint met een werkwoord in de infinitief, zonder klantnaam, max 80 tekens.
- deadline: JJJJ-MM-DD als de mail een moment noemt (reken "vrijdag", "volgende week", "na de vakantie" om vanaf ${dag}; "volgende week" = maandag van die week), anders null.
- citaat: de letterlijke zinsnede (max 160 tekens).
- Geen beleefdheden, geen dingen die de klant zelf moet doen, niets wat al gedaan is. Hoogstens 3 taken. Niets gevonden = [].`
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL(), max_tokens: 600, messages: [{ role: 'user', content: prompt }] }),
    })
    const json = await res.json().catch(() => null)
    if (!res.ok) return null
    const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
    const a = text.indexOf('{'), z = text.lastIndexOf('}')
    if (a < 0 || z < 0) return null
    const r = JSON.parse(text.slice(a, z + 1)) as { soort?: string; samenvatting?: string; taken?: unknown[] }
    const soort = p.richting === 'in' ? (SOORTEN.includes(r.soort as AiSoort) ? r.soort as AiSoort : 'anders') : null
    const samenvatting = p.richting === 'in' && typeof r.samenvatting === 'string' && r.samenvatting.trim() ? r.samenvatting.trim().slice(0, 160) : null
    const taken = (Array.isArray(r.taken) ? r.taken : []).slice(0, 3).map((t) => {
      const x = (t && typeof t === 'object' ? t : {}) as Record<string, unknown>
      const wat = String(x.wat ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
      const deadline = typeof x.deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.deadline) ? x.deadline : null
      return { wat, deadline, wie: (p.richting === 'uit' ? 'wij' : 'klant') as 'wij' | 'klant', citaat: typeof x.citaat === 'string' ? x.citaat.replace(/\s+/g, ' ').trim().slice(0, 200) || null : null }
    }).filter((t) => t.wat.length >= 4)
    return { soort, samenvatting, taken }
  } catch { return null }
}

/**
 * Nieuw project of niet? Streng: de meeste mails zijn het niet. Enkel het nieuwe
 * deel van een inkomende mail gaat mee, met wat we van de afzender weten (klant
 * of niet, lopende projecten). Altijd een voorstel: een mens beslist.
 */
export async function beoordeelProject(p: {
  onderwerp: string | null; tekst: string; datum: string; van: string | null; vanNaam: string | null
  klant: string | null; lopend: { titel: string; fase: string; diensten: string[] }[]; merk: 'NextGenMedia' | 'NextGenSolutions'; formulier: boolean
}): Promise<ProjectOordeel | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey || !p.tekst.trim()) return null
  const dag = p.datum.slice(0, 10)
  const afzender = [p.vanNaam?.slice(0, 80), p.van ? `<${p.van}>` : null].filter(Boolean).join(' ') || 'onbekend'
  const wie = p.klant
    ? `De afzender hoort bij onze bestaande klant "${p.klant.slice(0, 80)}".${p.lopend.length ? `\nLopende projecten van deze klant:\n${p.lopend.slice(0, 8).map((l) => `- ${l.titel.slice(0, 80)} (${l.fase}${l.diensten.length ? `, ${l.diensten.join(', ')}` : ''})`).join('\n')}` : '\nDeze klant heeft geen lopend project.'}`
    : p.lopend.length
      ? `De afzender is een prospect met een lopende kaart:\n${p.lopend.slice(0, 4).map((l) => `- ${l.titel.slice(0, 80)} (${l.fase})`).join('\n')}`
      : 'De afzender is (nog) geen klant van ons.'
  const prompt = `Je beoordeelt één inkomende mail voor een Belgisch bureau. NextGenMedia doet sociale media, grafisch ontwerp en branding, websites, foto en video, marketingconsultancy, Meta- en Google-advertenties en founder video's (Founders of Flanders). NextGenSolutions doet AI-automatisatie, chatbots en software op maat.

De vraag: is deze mail de start van een NIEUW project voor ons, waarvoor we een projectkaart in onze CRM moeten maken? Wees heel streng. De meeste mails zijn GEEN nieuw project.

JA, enkel als de afzender duidelijk iets nieuws van ons wil:
- een prijs, offerte, voorstel of kennismakingsgesprek vraagt voor een dienst die wij aanbieden;
- een aanvraag via een website- of contactformulier met een concrete vraag;
- een potentiële klant die duidelijk wil samenwerken of iets wil laten maken;
- een bestaande klant die iets vraagt dat buiten zijn lopende projecten valt (een nieuwe dienst, een nieuwe campagne, een extra opdracht) en daar een prijs of voorstel voor wil.

NEE bij:
- opvolging, feedback, planning, vragen of aanpassingen binnen een lopend project;
- facturen, betalingen, administratie, contracten die al lopen, toegang of wachtwoorden;
- iemand die ONS iets wil verkopen of aanbieden (bureaus, freelancers, SEO, leadgeneratie, software, sponsoring, advertentieruimte, samenwerkingsvoorstellen van leveranciers), sollicitaties, stages, studenten, enquêtes;
- nieuwsbrieven, meldingen, automatische mails, uitnodigingen voor events of webinars, spam;
- bedankjes, afspraken verzetten, algemene vragen zonder opdracht, vage interesse ("mooi werk!").
Twijfel = nee.

Mailbox: ${p.merk}. Ontvangen op ${dag}.${p.formulier ? ' Dit lijkt een melding van een websiteformulier: beoordeel wat de invuller vraagt.' : ''}
Afzender: ${afzender}
${wie}
Onderwerp: ${(p.onderwerp ?? '').slice(0, 200)}
---
${p.tekst.slice(0, 3000)}
---
Geef UITSLUITEND geldige JSON:
{
  "nieuw_project": true,
  "zekerheid": 0.0,
  "hoort_bij_lopend_project": false,
  "reden": "max 120 tekens: waarom wel of niet",
  "titel": "korte titel van het project, max 50 tekens, zonder klantnaam (bv. Nieuwe website, Meta-advertenties voor de opening)",
  "samenvatting": "2 à 3 korte zinnen in het Nederlands: wat staat er in de mail, zonder aanspreking",
  "project": "1 zin: wat het project inhoudt en wat ze van ons verwachten, met budget of timing als die er staan",
  "diensten": ["social_media|grafisch|webdesign|foto_video|consultancy|advertising|ngs|founders"],
  "ads": "meta|google|beide|null",
  "contact": { "bedrijf": "", "naam": "", "email": "", "telefoon": "", "website": "", "btw": "" }
}
zekerheid: hoe zeker je bent dat het een nieuw project is (0 = zeker niet, 1 = zeker wel).
hoort_bij_lopend_project: true als de vraag over een van de lopende projecten hierboven gaat.
contact: enkel wat letterlijk in de mail of de handtekening staat, anders leeg. Bij een formulier: de gegevens van wie het invulde.`
  // Niet bereikbaar of te druk: gooien, zodat de mail de volgende ronde opnieuw beoordeeld wordt.
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL(), max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
  })
  const json = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`AI niet bereikbaar (${res.status})`)
  const text: string = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  const a = text.indexOf('{'), z = text.lastIndexOf('}')
  if (a < 0 || z < 0) return null
  try { return naarOordeel(JSON.parse(text.slice(a, z + 1))) } catch { return null }
}
