import 'server-only'
import { createHash } from 'node:crypto'
import { createAdminSupabaseClient } from '@/lib/supabase/server'
import { BdaClient } from '@/lib/aanbestedingen/bda'
import { workspaceIdUit } from '@/lib/aanbestedingen/normalize'
import { haalDocumentenOp, tekstVanOpdracht } from '@/lib/aanbestedingen/documents'
import { relevanteDelen } from '@/lib/aanbestedingen/extract'

/**
 * De volledige analyse: enkel voor de opdrachten die de voorselectie
 * overleefden. Hier gaan de bestekken wél mee, en hier gebruiken we het sterke
 * model. Eén zo'n analyse kost enkele centen tot een halve euro; een hele run
 * onbeperkt laten lopen kost tientallen euro's. Vandaar de twee remmen:
 * `mail_drempel` bepaalt wat interessant genoeg is, `ai_top_x` hoeveel er per
 * run door mogen.
 *
 * DE BELANGRIJKSTE REGEL STAAT ONDERAAN: zonder tarieven in de kennisbank
 * noemen we GEEN prijs. Niet een geschatte, niet een indicatieve, geen enkele.
 * Een verzonnen bedrag in een offerte is erger dan geen bedrag — dat wordt
 * overgenomen en dan sta je eraan vast. Dat wordt hier in code afgedwongen en
 * niet enkel aan het model gevraagd.
 */

const MODEL = () => process.env.AANBESTEDINGEN_ANALYSE_MODEL || 'claude-sonnet-4-6'

/** Prijs per miljoen tokens, om de kost van een run te kunnen tonen. */
const PRIJS_IN = Number(process.env.AANBESTEDINGEN_ANALYSE_PRIJS_IN ?? 3)
const PRIJS_UIT = Number(process.env.AANBESTEDINGEN_ANALYSE_PRIJS_UIT ?? 15)

/** Hoeveel bestektekst er hoogstens mee mag. Bij 24.000 tekens zat in de test
 *  alles wat telt (gunningscriteria, prijs, erkenning) uit een bestek van
 *  427.000 tekens. */
const MAX_BESTEK = 24_000

export type Analyse = {
  samenvatting: string
  plan_van_aanpak: string
  gekozen_referenties: string[]
  prijs_bedrag: number | null
  prijs_type: string | null
  prijs_detail: { post: string; aantal: number | null; eenheid: string; tarief: number | null; bedrag: number | null }[]
  prijs_onderbouwing: string
  bestek_samenvatting: string
  selectiecriteria: string[]
  gevraagde_documenten: string[]
  gunningscriteria: { criterium: string; gewicht: string }[]
  checklist: { wat: string; klaar: boolean }[]
}

export type Kennisbank = {
  visie: string
  referenties: { klant: string; wat_we_deden: string; resultaat: string; sector_type: string }[]
  tarieven: { dienst: string; tarief: number; eenheid: string; opmerking: string }[]
  documenten: string
}

/** Alles wat we over onszelf weten, voor deze workspace. */
export async function kennisbankVoor(filterId: string): Promise<Kennisbank> {
  const admin = createAdminSupabaseClient()
  const [kennis, refs, tarieven, docs] = await Promise.all([
    admin.from('aanbesteding_kennis').select('visie').eq('filter_id', filterId).maybeSingle(),
    admin.from('aanbesteding_referenties').select('klant, wat_we_deden, resultaat, sector_type')
      .eq('filter_id', filterId).limit(40),
    admin.from('aanbesteding_tarieven').select('dienst, tarief, eenheid, opmerking')
      .eq('filter_id', filterId).limit(60),
    admin.from('aanbesteding_kennisdocumenten').select('name, tekst')
      .eq('filter_id', filterId).limit(20),
  ])

  const documentTekst = ((docs.data ?? []) as { name: string; tekst: string | null }[])
    .filter((d) => d.tekst)
    .map((d) => `===== ${d.name} =====\n${d.tekst}`)
    .join('\n\n')
    .slice(0, 12_000)

  return {
    visie: (kennis.data as { visie: string | null } | null)?.visie?.trim() ?? '',
    referenties: ((refs.data ?? []) as Kennisbank['referenties']).map((r) => ({
      klant: r.klant ?? '', wat_we_deden: r.wat_we_deden ?? '',
      resultaat: r.resultaat ?? '', sector_type: r.sector_type ?? '',
    })),
    tarieven: ((tarieven.data ?? []) as Kennisbank['tarieven']).map((t) => ({
      dienst: t.dienst ?? '', tarief: Number(t.tarief) || 0,
      eenheid: t.eenheid ?? 'uur', opmerking: t.opmerking ?? '',
    })).filter((t) => t.dienst && t.tarief > 0),
    documenten: documentTekst,
  }
}

/**
 * Vingerafdruk van een volledige analyse: de opdracht én de bestektekst.
 *
 * Los van de hash van de voorselectie, want die kent de documenten niet. Zonder
 * de bestektekst erin zou een analyse die vóór het downloaden liep nooit meer
 * overgedaan worden, en dan blijft er een leeg dossier staan.
 */
export function analyseHash(referentie: string, titel: string, bestek: string): string {
  return createHash('sha256')
    .update(`${referentie} ${titel} ${bestek}`)
    .digest('hex').slice(0, 32)
}

/**
 * Een bedrag uit het antwoord halen, in beide schrijfwijzen.
 *
 * "€ 48.500,50" is Belgisch, "48,500.50" is Engels, en beide komen voor. Naïef
 * de komma door een punt vervangen maakte van het eerste 48.500.50 — geen
 * getal, dus null, dus een bedrag dat spoorloos verdween. De laatste scheiding
 * is de decimale; de andere is duizendtallen.
 */
export function leesBedrag(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null

  let s = String(v).replace(/[^0-9.,-]/g, '')
  if (!s) return null

  const laatstePunt = s.lastIndexOf('.')
  const laatsteKomma = s.lastIndexOf(',')

  if (laatstePunt >= 0 && laatsteKomma >= 0) {
    // Allebei aanwezig: de laatste is de decimale scheiding.
    const decimaal = laatstePunt > laatsteKomma ? '.' : ','
    const duizend = decimaal === '.' ? ',' : '.'
    s = s.split(duizend).join('')
    if (decimaal === ',') s = s.replace(',', '.')
  } else if (laatsteKomma >= 0) {
    // Enkel komma's: Belgische schrijfwijze, dus decimaal — tenzij het er
    // meerdere zijn, dan zijn het duizendtallen ("1,234,567").
    s = s.split(',').length > 2 ? s.split(',').join('') : s.replace(',', '.')
  } else if (laatstePunt >= 0) {
    // Enkel punten. Precies drie cijfers erachter en iets ervoor: duizendtallen
    // ("48.500"). Anders decimaal ("48.5").
    const na = s.length - laatstePunt - 1
    const meerdere = s.split('.').length > 2
    if (meerdere || (na === 3 && laatstePunt > 0)) s = s.split('.').join('')
  }

  const n = Number(s)
  return Number.isFinite(n) && n > 0 ? n : null
}

const alsLijst = (v: unknown, max: number, lengte = 300): string[] =>
  Array.isArray(v)
    ? v.map((x) => String(typeof x === 'object' && x ? JSON.stringify(x) : x).trim())
      .filter(Boolean).slice(0, max).map((s) => s.slice(0, lengte))
    : []

/**
 * Het antwoord uitlezen. Alles wat we niet herkennen wordt leeg, nooit geraden.
 * Een half ingevuld dossier waarvan je ziet wát er ontbreekt is bruikbaar; een
 * dossier met verzonnen vulling niet.
 */
export function parseAnalyse(tekst: string): Analyse | null {
  const start = tekst.indexOf('{')
  const eind = tekst.lastIndexOf('}')
  if (start === -1 || eind === -1 || eind < start) return null

  let r: Record<string, unknown>
  try { r = JSON.parse(tekst.slice(start, eind + 1)) as Record<string, unknown> } catch { return null }

  const getal = leesBedrag

  const detail = Array.isArray(r.prijs_detail)
    ? (r.prijs_detail as unknown[]).slice(0, 40).map((p) => {
      const o = (p ?? {}) as Record<string, unknown>
      return {
        post: String(o.post ?? '').slice(0, 200),
        aantal: getal(o.aantal),
        eenheid: String(o.eenheid ?? '').slice(0, 40),
        tarief: getal(o.tarief),
        bedrag: getal(o.bedrag),
      }
    }).filter((p) => p.post)
    : []

  const gunning = Array.isArray(r.gunningscriteria)
    ? (r.gunningscriteria as unknown[]).slice(0, 20).map((g) => {
      const o = (g ?? {}) as Record<string, unknown>
      return {
        criterium: String(o.criterium ?? o.naam ?? '').slice(0, 200),
        gewicht: String(o.gewicht ?? o.punten ?? '').slice(0, 40),
      }
    }).filter((g) => g.criterium)
    : []

  const checklist = Array.isArray(r.checklist)
    ? (r.checklist as unknown[]).slice(0, 40).map((c) => {
      const o = typeof c === 'string' ? { wat: c } : ((c ?? {}) as Record<string, unknown>)
      return { wat: String(o.wat ?? o.taak ?? '').slice(0, 250), klaar: false }
    }).filter((c) => c.wat)
    : []

  return {
    samenvatting: String(r.samenvatting ?? '').slice(0, 4000),
    plan_van_aanpak: String(r.plan_van_aanpak ?? '').slice(0, 12000),
    gekozen_referenties: alsLijst(r.gekozen_referenties, 10, 200),
    prijs_bedrag: getal(r.prijs_bedrag),
    prijs_type: r.prijs_type ? String(r.prijs_type).slice(0, 60) : null,
    prijs_detail: detail,
    prijs_onderbouwing: String(r.prijs_onderbouwing ?? '').slice(0, 4000),
    bestek_samenvatting: String(r.bestek_samenvatting ?? '').slice(0, 6000),
    selectiecriteria: alsLijst(r.selectiecriteria, 30),
    gevraagde_documenten: alsLijst(r.gevraagde_documenten, 40, 250),
    gunningscriteria: gunning,
    checklist,
  }
}

/**
 * Zonder tarieven geen prijs — in code, niet enkel in de prompt.
 *
 * Een model dat je vraagt "verzin geen bedragen" doet dat meestal, maar
 * "meestal" is hier niet goed genoeg: dit bedrag belandt in een offerte aan de
 * overheid. Wat het model ook antwoordt, zonder tarieven wissen we het.
 */
export function pasPrijsregelToe(a: Analyse, heeftTarieven: boolean): Analyse {
  if (heeftTarieven) return a
  const gewist = a.prijs_bedrag !== null || a.prijs_detail.length > 0
  return {
    ...a,
    prijs_bedrag: null,
    prijs_type: null,
    prijs_detail: [],
    prijs_onderbouwing: gewist
      ? 'Geen prijs berekend: er staan nog geen tarieven in de kennisbank. Vul die aan en analyseer opnieuw.'
      : a.prijs_onderbouwing || 'Geen prijs berekend: er staan nog geen tarieven in de kennisbank.',
  }
}

function prompt(k: Kennisbank, opdracht: Record<string, unknown>, bestek: string): string {
  const tarieven = k.tarieven.length
    ? k.tarieven.map((t) => `- ${t.dienst}: € ${t.tarief} per ${t.eenheid}${t.opmerking ? ` (${t.opmerking})` : ''}`).join('\n')
    : null

  return `Je bereidt een offerte voor op een Belgische overheidsopdracht. Je werkt voor het bureau hieronder en schrijft in het Nederlands.

## Wie wij zijn
${k.visie || '(nog niet ingevuld)'}

## Onze eerdere opdrachten
${k.referenties.length
  ? k.referenties.map((r, i) => `${i + 1}. ${r.klant} — ${r.wat_we_deden}${r.resultaat ? ` Resultaat: ${r.resultaat}` : ''}${r.sector_type ? ` [${r.sector_type}]` : ''}`).join('\n')
  : '(nog geen referenties ingevuld)'}

## Onze tarieven
${tarieven ?? 'ER ZIJN GEEN TARIEVEN BEKEND.'}

${k.documenten ? `## Uit onze eigen documenten\n${k.documenten}\n` : ''}
## De opdracht
${Object.entries(opdracht).filter(([, v]) => v).map(([kk, v]) => `${kk}: ${v}`).join('\n')}

## Uit het bestek
${bestek || '(geen bestektekst beschikbaar — zeg dat in bestek_samenvatting en laat de criteria leeg)'}

---

Geef UITSLUITEND geldige JSON terug:
{
  "samenvatting": "wat vraagt men, in vijf tot acht zinnen",
  "bestek_samenvatting": "de harde eisen uit het bestek: termijnen, vormvereisten, hoe indienen",
  "selectiecriteria": ["eis waaraan de inschrijver moet voldoen", "..."],
  "gevraagde_documenten": ["document dat bij de offerte moet", "..."],
  "gunningscriteria": [{"criterium":"Prijs","gewicht":"40%"}],
  "plan_van_aanpak": "onze aanpak, in alinea's, concreet en zonder holle woorden",
  "gekozen_referenties": ["welke van onze eerdere opdrachten hier het sterkst zijn, en waarom"],
  "prijs_bedrag": null,
  "prijs_type": null,
  "prijs_detail": [{"post":"...","aantal":10,"eenheid":"uur","tarief":95,"bedrag":950}],
  "prijs_onderbouwing": "hoe je aan het bedrag komt",
  "checklist": [{"wat":"concrete taak vóór indienen"}]
}

Regels waar je niet van afwijkt:
- ALLES wat je over het bestek zegt moet LETTERLIJK in de bestektekst hierboven staan. Staat er niets over gunningscriteria, geef dan een lege lijst. Vul nooit aan met wat gebruikelijk is.
${tarieven
  ? '- Reken de prijs UITSLUITEND met de tarieven hierboven. Gebruikt de opdracht een post waarvoor wij geen tarief hebben, laat die dan uit prijs_detail en zeg in prijs_onderbouwing welk tarief ontbreekt.'
  : '- ER ZIJN GEEN TARIEVEN. Zet prijs_bedrag op null, laat prijs_detail leeg en schrijf in prijs_onderbouwing dat er geen tarieven in de kennisbank staan. Verzin GEEN bedrag, ook geen richtprijs, ook geen orde van grootte.'}
- Kies enkel referenties uit de lijst hierboven. Verzin er geen bij.
- Het plan van aanpak gaat over deze opdracht. Geen algemene marketingpraat.
- Bij twijfel: schrijf wat je NIET weet. Dat is bruikbaar; een gladde tekst met gaten erin niet.`
}

export type AnalyseResultaat = {
  aangeboden: number
  geanalyseerd: number
  gestopt: boolean
  overgeslagen: number
  mislukt: number
  zonder_bestek: number
  kost_usd: number
}

/** Eén opdracht volledig uitwerken. */
async function analyseerEen(
  filterId: string,
  opdracht: { referentienummer: string; titel: string | null; link: string | null; [k: string]: unknown },
  k: Kennisbank,
  client: BdaClient,
): Promise<{ status: 'ok' | 'ongewijzigd' | 'mislukt'; zonderBestek: boolean; kost: number; reden?: string }> {
  const admin = createAdminSupabaseClient()

  // Documenten eerst. Al binnengehaalde documenten worden overgeslagen, dus dit
  // is goedkoop bij een tweede poging.
  const workspaceId = workspaceIdUit(opdracht.link ?? '')
  if (workspaceId) {
    try {
      await haalDocumentenOp(filterId, opdracht.referentienummer, workspaceId, client)
    } catch (e) {
      // Geen bestek is jammer maar niet fataal: de analyse gaat door op wat we
      // uit de publicatie zelf weten, en dat staat straks in het dossier.
      console.error('[aanbestedingen] documenten ophalen mislukt:', e instanceof Error ? e.message : e)
    }
  }

  const { tekst, documenten, onleesbaar } = await tekstVanOpdracht(filterId, opdracht.referentienummer)
  const bestek = relevanteDelen(tekst, MAX_BESTEK)
  const hash = analyseHash(opdracht.referentienummer, opdracht.titel ?? '', bestek)

  const { data: bestaand } = await admin
    .from('aanbesteding_analyse')
    .select('content_hash, volledig')
    .eq('filter_id', filterId)
    .eq('referentienummer', opdracht.referentienummer)
    .maybeSingle()
  const al = bestaand as { content_hash: string | null; volledig: boolean } | null
  // Al uitgewerkt en er is niets veranderd? Dan niet opnieuw betalen.
  if (al?.volledig && al.content_hash === hash) {
    return { status: 'ongewijzigd', zonderBestek: documenten === 0, kost: 0 }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('AI niet geconfigureerd: ANTHROPIC_API_KEY ontbreekt in deze omgeving.')

  const beschrijving: Record<string, unknown> = {
    referentie: opdracht.referentienummer,
    titel: opdracht.titel,
    aanbesteder: opdracht.organisatie,
    cpv: [opdracht.cpv_hoofdcode, opdracht.cpv_hoofd_omschrijving].filter(Boolean).join(' '),
    aard: opdracht.aard,
    procedure: opdracht.procedure,
    uiterste_indieningsdatum: opdracht.uiterste_indieningsdatum_raw ?? opdracht.uiterste_indieningsdatum,
    omschrijving: String(opdracht.beschrijving ?? '').slice(0, 3000),
  }

  let res: Response
  try {
    res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL(),
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt(k, beschrijving, bestek) }],
      }),
    })
  } catch (e) {
    return { status: 'mislukt', zonderBestek: documenten === 0, kost: 0, reden: e instanceof Error ? e.message : 'netwerkfout' }
  }

  const json = await res.json().catch(() => null)
  if (!res.ok) {
    return {
      status: 'mislukt', zonderBestek: documenten === 0, kost: 0,
      reden: json?.error?.message || `HTTP ${res.status}`,
    }
  }

  const inTok = Number(json?.usage?.input_tokens ?? 0)
  const uitTok = Number(json?.usage?.output_tokens ?? 0)
  const kost = (inTok / 1e6) * PRIJS_IN + (uitTok / 1e6) * PRIJS_UIT

  const antwoord = (json?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('')
  const ruw = parseAnalyse(antwoord)
  if (!ruw) return { status: 'mislukt', zonderBestek: documenten === 0, kost, reden: 'geen bruikbare JSON' }

  const a = pasPrijsregelToe(ruw, k.tarieven.length > 0)

  const { error } = await admin.from('aanbesteding_analyse').upsert({
    filter_id: filterId,
    referentienummer: opdracht.referentienummer,
    volledig: true,
    samenvatting: a.samenvatting,
    plan_van_aanpak: a.plan_van_aanpak,
    gekozen_referenties: a.gekozen_referenties,
    prijs_bedrag: a.prijs_bedrag,
    prijs_type: a.prijs_type,
    prijs_detail: a.prijs_detail,
    prijs_onderbouwing: a.prijs_onderbouwing,
    prijs_bevestigd: false,
    // Vertel eerlijk waar het dossier op gebouwd is. Een analyse zonder bestek
    // ziet er even net uit als een analyse mét, en dat verschil moet je zien.
    bestek_status: documenten === 0
      ? 'geen bestek beschikbaar'
      : onleesbaar.length
        ? `${documenten} document(en) gelezen, niet gelukt: ${onleesbaar.join(', ')}`
        : `${documenten} document(en) gelezen`,
    bestek_bronnen: onleesbaar,
    bestek_samenvatting: a.bestek_samenvatting,
    selectiecriteria: a.selectiecriteria,
    gevraagde_documenten: a.gevraagde_documenten,
    gunningscriteria: a.gunningscriteria,
    checklist: a.checklist,
    model: MODEL(),
    input_tokens: inTok,
    output_tokens: uitTok,
    kost_usd: kost,
    content_hash: hash,
    gegenereerd_op: new Date().toISOString(),
  }, { onConflict: 'filter_id,referentienummer' })
  if (error) return { status: 'mislukt', zonderBestek: documenten === 0, kost, reden: error.message }

  return { status: 'ok', zonderBestek: documenten === 0, kost }
}

/**
 * De top van de voorselectie volledig uitwerken.
 *
 * Wie komt er door: gescoord op of boven `mail_drempel`, nog niet ingediend of
 * genegeerd, deadline nog niet voorbij — en daarvan de `ai_top_x` hoogste.
 */
export async function analyseerWorkspace(
  ws: { id: string; ai_top_x: number; mail_drempel: number },
  opties: {
    onVoortgang?: (nu: number, totaal: number, wat: string) => void | Promise<void>
    /** Tussen twee dossiers gevraagd; afgeronde dossiers blijven bewaard. */
    stoppen?: () => Promise<boolean>
  } = {},
): Promise<AnalyseResultaat> {
  const admin = createAdminSupabaseClient()
  const uit: AnalyseResultaat = {
    aangeboden: 0, geanalyseerd: 0, overgeslagen: 0, mislukt: 0, zonder_bestek: 0,
    gestopt: false, kost_usd: 0,
  }

  const { data: scoreRijen } = await admin
    .from('aanbesteding_analyse')
    .select('referentienummer, score')
    .eq('filter_id', ws.id)
    .gte('score', ws.mail_drempel)
    .order('score', { ascending: false })
    .limit(Math.max(1, ws.ai_top_x))
  const kandidaten = (scoreRijen ?? []) as { referentienummer: string; score: number }[]
  if (kandidaten.length === 0) return uit

  const { data: opdrachtRijen } = await admin
    .from('aanbestedingen')
    .select('referentienummer, titel, beschrijving, organisatie, cpv_hoofdcode, cpv_hoofd_omschrijving, aard, procedure, link, uiterste_indieningsdatum, uiterste_indieningsdatum_raw')
    .eq('filter_id', ws.id)
    .eq('ingediend', false)
    .eq('genegeerd', false)
    .in('referentienummer', kandidaten.map((k) => k.referentienummer))

  const nu = Date.now()
  const opdrachten = ((opdrachtRijen ?? []) as { referentienummer: string; titel: string | null; link: string | null; uiterste_indieningsdatum: string | null }[])
    .filter((o) => !o.uiterste_indieningsdatum || new Date(o.uiterste_indieningsdatum).getTime() >= nu)
    // In dezelfde volgorde als de scores: de beste eerst, zodat een run die
    // vastloopt op tijd toch de belangrijkste dossiers af heeft.
    .sort((a, b) =>
      kandidaten.findIndex((k) => k.referentienummer === a.referentienummer) -
      kandidaten.findIndex((k) => k.referentienummer === b.referentienummer))

  uit.aangeboden = opdrachten.length
  if (opdrachten.length === 0) return uit

  const k = await kennisbankVoor(ws.id)
  const client = new BdaClient()

  for (let i = 0; i < opdrachten.length; i++) {
    const o = opdrachten[i]
    await opties.onVoortgang?.(i, opdrachten.length, o.titel ?? o.referentienummer)
    try {
      const r = await analyseerEen(ws.id, o as never, k, client)
      uit.kost_usd += r.kost
      if (r.zonderBestek) uit.zonder_bestek++
      if (r.status === 'ok') uit.geanalyseerd++
      else if (r.status === 'ongewijzigd') uit.overgeslagen++
      else {
        uit.mislukt++
        console.error(`[aanbestedingen] analyse ${o.referentienummer} mislukt: ${r.reden ?? '?'}`)
      }
    } catch (e) {
      // Eén dossier dat klapt mag de rest van de run niet meenemen.
      uit.mislukt++
      console.error(`[aanbestedingen] analyse ${o.referentienummer} klapte:`, e instanceof Error ? e.message : e)
    }

    // Pas na een afgerond dossier. Halverwege stoppen zou een half
    // weggeschreven analyse achterlaten.
    if (await opties.stoppen?.()) { uit.gestopt = true; break }
  }
  await opties.onVoortgang?.(opdrachten.length, opdrachten.length, '')

  return uit
}
