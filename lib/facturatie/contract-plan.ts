// Facturen plannen uit een getekend contract — pure module (client-safe, getest in
// tests/contract-plan.test.ts).
//
// Een contract bestaat uit één of meer posten: een terugkerend bedrag
// (maandelijks, per kwartaal, per jaar …) en/of eenmalige bedragen (opstart,
// website). Elke post wordt een reeks factuuritems "Te factureren", elk met een
// duidelijke titel en een omschrijving met wat inbegrepen is:
//   Sociale media management (november 2026)
//   Hosting Q1 2027
//   Website (eenmalig: gewoon de naam)
// De server (contract-plan-server.ts) vult de posten uit het contract en de pdf.

import { FREQUENTIES, maandPlus, type Frequentie } from './factuurvoorstellen'

export type PlanPost = {
  /** Korte naam zoals hij op de factuur hoort: "Sociale media management". */
  naam: string
  soort: 'eenmalig' | 'terugkerend'
  /** Enkel bij terugkerend. */
  frequentie: Frequentie | null
  /** Excl. btw per periode (bij eenmalig: het totaal). */
  bedrag: number | null
  /** Aantal facturen; null bij terugkerend = onbepaalde duur. */
  perioden: number | null
  /** Start van de dienstverlening of factuurdatum (eenmalig), 'YYYY-MM-DD'. */
  start: string | null
  inbegrepen: string[]
  /** Eén of twee zakelijke zinnen voor op de factuur (uit het contract gelezen). Optioneel. */
  omschrijving?: string | null
}

export type PlanInvoer = {
  contractTitel: string
  /** 'YYYY-MM-DD' of null. Ook de terugval als een post geen startdatum heeft. */
  getekendOp: string | null
  /** Hoe die terugval heet in de opmerking: standaard "de ondertekening" (nog niet getekend: "vandaag"). */
  terugvalLabel?: string
  posten: PlanPost[]
  btwPct: number
  /** Factuurdatum: eerste of laatste dag van de periode. */
  moment: 'eerste' | 'laatste'
}

export type PlanFactuur = {
  /** Uniek binnen het contract; de server zet er `<contractId>:` voor. */
  sleutel: string
  periode: string
  van: string
  tot: string
  datum: string
  titel: string
  omschrijving: string
  bedrag: number
  btw: number
  eenheid: 'maand' | 'forfait'
  post: number
}

export type Plan = { facturen: PlanFactuur[]; totaal: number; ontbreekt: string[]; opmerkingen: string[] }

/** Zonder einddatum plannen we één jaar vooruit. */
export const ONBEPAALD_MAANDEN = 12
const MAX_PERIODEN = 60

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
const ISO = /^\d{4}-\d{2}-\d{2}$/
const laatsteDag = (m: string) => { const [y, mm] = m.split('-').map(Number); return new Date(Date.UTC(y, mm, 0)).getUTCDate() }
const maandNaam = (m: string) => `${MAANDEN[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}`
const rond = (n: number) => Math.round(n * 100) / 100
const euro = (n: number) => `€ ${n.toLocaleString('nl-BE', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`

export function datumLang(iso: string): string {
  return `${Number(iso.slice(8, 10))} ${MAANDEN[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`
}

/** "november 2026", "Q1 2027", "H2 2027", "2027" of "november 2026 – januari 2027". */
export function periodeNaam(vanM: string, maanden: number): string {
  const m = Number(vanM.slice(5, 7)), jaar = vanM.slice(0, 4)
  if (maanden <= 1) return maandNaam(vanM)
  if (maanden === 3 && (m - 1) % 3 === 0) return `Q${(m - 1) / 3 + 1} ${jaar}`
  if (maanden === 6 && (m === 1 || m === 7)) return `H${m === 1 ? 1 : 2} ${jaar}`
  if (maanden === 12 && m === 1) return jaar
  const tot = maandPlus(vanM, maanden - 1)
  return vanM.slice(0, 4) === tot.slice(0, 4) ? `${MAANDEN[m - 1]} – ${maandNaam(tot)}` : `${maandNaam(vanM)} – ${maandNaam(tot)}`
}

/** Titel van één factuur: "Sociale media management (november 2026)", "Hosting Q1 2027". */
export function factuurTitel(naam: string, vanM: string, maanden: number): string {
  const p = periodeNaam(vanM, maanden)
  return /^(Q\d|H\d|\d{4}$)/.test(p) ? `${naam} ${p}` : `${naam} (${p})`
}

/** "a, b en c" */
function opsomming(lijst: string[]): string {
  const l = lijst.map((x) => x.trim().replace(/[.;]+$/, '')).filter(Boolean)
    // Kleine letter tenzij het een naam of afkorting is ("Instagram", "SEO").
    .map((x) => (/^[A-Z][a-z]/.test(x) && !/^(Instagram|Facebook|LinkedIn|TikTok|YouTube|Google|Meta|Pinterest|WordPress|Shopify)\b/.test(x) ? x[0].toLowerCase() + x.slice(1) : x))
  return l.length <= 1 ? (l[0] ?? '') : `${l.slice(0, -1).join(', ')} en ${l[l.length - 1]}`
}

/**
 * De omschrijving op de factuur: één duidelijke zin, bij een terugkerende post
 * telkens dezelfde met enkel een andere periode, bv. "Socialmediadiensten
 * conform overeenkomst voor de periode januari 2027, inclusief contentplanning,
 * creatie en publicatie van berichten en beheer van de afgesproken sociale
 * mediakanalen." De tekst uit het contract (AI) mag "[periode]" bevatten.
 */
function omschrijvingVoor(p: { naam: string; periode: string | null; inbegrepen: string[]; tekst?: string | null }): string {
  const t = p.tekst?.replace(/\s+/g, ' ').trim()
  if (t) {
    const zin = /[.!?]$/.test(t) ? t : `${t}.`
    if (!p.periode) return zin.replace(/\s*(voor|in|over|tijdens)\s+de\s+periode\s+\[periode\]/gi, '').replace(/\s*\[periode\]/gi, '').replace(/\s+([,.])/g, '$1')
    if (/\[periode\]/i.test(zin)) return zin.replace(/\[periode\]/gi, p.periode)
    if (/conform (de )?overeenkomst/i.test(zin)) return zin.replace(/conform (de )?overeenkomst/i, (m) => `${m} voor de periode ${p.periode}`)
    return `${zin.replace(/\.$/, '')} voor de periode ${p.periode}.`
  }
  const incl = p.inbegrepen.length ? `, inclusief ${opsomming(p.inbegrepen)}` : ''
  return p.periode ? `${p.naam} conform overeenkomst voor de periode ${p.periode}${incl}.` : `${p.naam} conform overeenkomst${incl}.`
}

/** Het plan: alle facturen van alle posten, met wat ontbreekt en wat je best nakijkt. */
export function maakPlan(invoer: PlanInvoer): Plan {
  const ontbreekt: string[] = [], opmerkingen: string[] = [], facturen: PlanFactuur[] = []
  if (!invoer.posten.length) ontbreekt.push('wat er gefactureerd wordt (dienst en bedrag)')
  const btw = invoer.btwPct
  invoer.posten.forEach((post, i) => {
    const naam = post.naam.trim() || 'Dienstverlening'
    const wie = invoer.posten.length > 1 ? ` (${naam})` : ''
    if (!(post.bedrag !== null && post.bedrag > 0)) { ontbreekt.push(`bedrag${wie}`); return }
    const bedrag = rond(post.bedrag)
    const voor = i === 0 ? '' : `p${i + 1}:`
    let start = post.start && ISO.test(post.start) ? post.start : null
    if (!start && invoer.getekendOp) { start = invoer.getekendOp; opmerkingen.push(`Geen startdatum gevonden${wie}: gepland vanaf ${invoer.terugvalLabel ?? 'de ondertekening'} (${datumLang(start)}). Kijk dat na.`) }
    if (!start) { ontbreekt.push(`startdatum${wie}`); return }

    if (post.soort === 'eenmalig' || post.frequentie === 'eenmalig') {
      facturen.push({
        sleutel: `${voor}eenmalig:${start}`, periode: start.slice(0, 7), van: start, tot: start, datum: start,
        titel: naam, omschrijving: omschrijvingVoor({ naam, periode: null, inbegrepen: post.inbegrepen, tekst: post.omschrijving }),
        bedrag, btw, eenheid: 'forfait', post: i,
      })
      return
    }
    const f = FREQUENTIES.find((x) => x.key === post.frequentie)
    if (!f || f.maanden === 0) { ontbreekt.push(`hoe vaak er gefactureerd wordt${wie}`); return }
    let aantal = post.perioden && post.perioden > 0 ? Math.round(post.perioden) : null
    if (!aantal) {
      aantal = Math.ceil(ONBEPAALD_MAANDEN / f.maanden)
      opmerkingen.push(`Geen einddatum${wie}: het eerste jaar is gepland (${aantal} ${aantal === 1 ? 'factuur' : 'facturen'}).`)
    }
    if (aantal > MAX_PERIODEN) { opmerkingen.push(`Meer dan ${MAX_PERIODEN} facturen${wie}: enkel de eerste ${MAX_PERIODEN} gepland.`); aantal = MAX_PERIODEN }
    for (let n = 0; n < aantal; n++) {
      const vanM = maandPlus(start.slice(0, 7), n * f.maanden)
      const totM = maandPlus(vanM, f.maanden - 1)
      const van = `${vanM}-01`, tot = `${totM}-${String(laatsteDag(totM)).padStart(2, '0')}`
      facturen.push({
        sleutel: `${voor}${vanM}`, periode: vanM, van, tot, datum: invoer.moment === 'laatste' ? tot : van,
        titel: factuurTitel(naam, vanM, f.maanden),
        omschrijving: omschrijvingVoor({ naam, periode: periodeNaam(vanM, f.maanden), inbegrepen: post.inbegrepen, tekst: post.omschrijving }),
        bedrag, btw, eenheid: f.maanden === 1 ? 'maand' : 'forfait', post: i,
      })
    }
  })
  const totaal = rond(facturen.reduce((s, f) => s + f.bedrag, 0))
  return { facturen, totaal, ontbreekt, opmerkingen }
}

/** Korte samenvatting voor de tijdlijn en het contract: "6 facturen, juli – december 2026, € 5.874". */
export function planSamenvatting(plan: Plan): string {
  if (!plan.facturen.length) return 'Geen facturen gepland'
  const eerste = plan.facturen.reduce((a, b) => (a.datum <= b.datum ? a : b))
  const laatste = plan.facturen.reduce((a, b) => (a.datum >= b.datum ? a : b))
  const a = eerste.periode, b = laatste.periode
  const bereik = a === b ? maandNaam(a) : a.slice(0, 4) === b.slice(0, 4) ? `${MAANDEN[Number(a.slice(5, 7)) - 1]} – ${maandNaam(b)}` : `${maandNaam(a)} – ${maandNaam(b)}`
  return `${plan.facturen.length} ${plan.facturen.length === 1 ? 'factuur' : 'facturen'}, ${bereik}, ${euro(plan.totaal)} excl. btw`
}

/** Naam van de dienst voor op de factuur, uit de dienst of het type van het contract. */
export const DIENST_NAAM: Record<string, string> = {
  'social-media': 'Sociale media management',
  webdesign: 'Website',
  'marketing-consultancy': 'Marketingconsultancy',
  'grafisch-ontwerp': 'Grafisch ontwerp',
  ads: 'Advertentiebeheer',
  'foto-video': 'Foto- en videografie',
}

export function dienstNaam(c: { service_slug?: string | null; contract_type?: string | null; title?: string | null }): string {
  if (c.service_slug && DIENST_NAAM[c.service_slug]) return DIENST_NAAM[c.service_slug]
  const t = String(c.contract_type ?? '').trim()
  if (t && t !== 'Niet toegewezen') return t.replace(/\s*contract$/i, '').trim() || t
  return String(c.title ?? '').trim() || 'Dienstverlening'
}

// ── Posten bepalen: wat het team in de app invulde gaat voor, de pdf vult aan ──

export type ContractVelden = {
  title?: string | null; service_slug?: string | null; contract_type?: string | null
  start_date?: string | null; end_date?: string | null; duration_type?: string | null
  invoice_frequency?: string | null; expected_invoice_count?: number | string | null
  expected_invoice_amount_excl?: number | string | null; contract_waarde_excl?: number | string | null
}
export type AiPosten = { posten: PlanPost[]; btwPct: number | null; moment: 'eerste' | 'laatste' | null; opmerking: string | null; analyse?: string | null }

const getal = (v: unknown): number | null => { if (v === null || v === undefined || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null }

/** Contractduur in maanden: '12m', of uit start en einde (einde = eerste dag na de looptijd). */
export function duurMaanden(c: ContractVelden): number | null {
  const m = String(c.duration_type ?? '').match(/^(\d+)m$/)
  if (m) return Number(m[1])
  const s = c.start_date?.slice(0, 10), e = c.end_date?.slice(0, 10)
  if (s && e && ISO.test(s) && ISO.test(e) && e > s) {
    const [y1, m1, d1] = s.split('-').map(Number), [y2, m2, d2] = e.split('-').map(Number)
    let n = (y2 - y1) * 12 + (m2 - m1)
    if (d2 > d1) n += 1
    return Math.max(1, n)
  }
  return null
}

/** Hoe vaak: uit invoice_frequency, anders uit het looptijdtype ('eenmalig', 'maandelijks'). */
export function frequentieVan(c: ContractVelden): Frequentie | null {
  const s = String(c.invoice_frequency ?? '').toLowerCase().trim()
  const map: Record<string, Frequentie> = {
    maandelijks: 'maandelijks', monthly: 'maandelijks', maand: 'maandelijks', tweemaandelijks: 'tweemaandelijks',
    kwartaal: 'kwartaal', quarterly: 'kwartaal', 'per kwartaal': 'kwartaal', driemaandelijks: 'kwartaal',
    halfjaarlijks: 'halfjaarlijks', jaarlijks: 'jaarlijks', yearly: 'jaarlijks', annual: 'jaarlijks', eenmalig: 'eenmalig', once: 'eenmalig',
  }
  if (map[s]) return map[s]
  const d = String(c.duration_type ?? '').toLowerCase()
  if (d === 'eenmalig') return 'eenmalig'
  if (d === 'maandelijks') return 'maandelijks'
  return null
}

const perFreq = (f: Frequentie) => FREQUENTIES.find((x) => x.key === f)?.maanden ?? 0

/**
 * De posten voor het plan. Uit de pdf (AI) komen naam, onderdelen en wat
 * inbegrepen is; wat het team in de app vastlegde (start, frequentie, bedrag
 * per factuur, aantal) gaat voor op de hoofdpost. Zonder pdf-lezing: één post
 * uit de contractgegevens.
 */
export function postenVoorContract(c: ContractVelden, ai: AiPosten | null, klantBtw?: string | null): { posten: PlanPost[]; btwPct: number; moment: 'eerste' | 'laatste'; opmerkingen: string[] } {
  const opmerkingen: string[] = []
  const freq = frequentieVan(c)
  const duur = duurMaanden(c)
  const waarde = getal(c.contract_waarde_excl)
  const perFactuur = getal(c.expected_invoice_amount_excl)
  const aantal = getal(c.expected_invoice_count)
  const start = c.start_date && ISO.test(c.start_date.slice(0, 10)) ? c.start_date.slice(0, 10) : null
  const naam = dienstNaam(c)
  let posten: PlanPost[]

  if (ai && ai.posten.length) {
    posten = ai.posten.map((p) => ({ ...p, naam: p.naam || naam, inbegrepen: [...p.inbegrepen] }))
    const hoofd = posten.find((p) => p.soort === 'terugkerend') ?? posten[0]
    if (hoofd.soort === 'terugkerend') {
      if (freq && freq !== 'eenmalig') hoofd.frequentie = freq
      if (start) hoofd.start = start
      if (perFactuur !== null && perFactuur > 0) hoofd.bedrag = perFactuur
      if (aantal !== null && aantal > 0) hoofd.perioden = Math.round(aantal)
      else if (!hoofd.perioden && duur && hoofd.frequentie && perFreq(hoofd.frequentie) > 0) hoofd.perioden = Math.ceil(duur / perFreq(hoofd.frequentie))
    } else if (posten.length === 1) {
      if (!hoofd.start && start) hoofd.start = start
      if (!hoofd.bedrag && (perFactuur ?? waarde)) hoofd.bedrag = perFactuur ?? waarde
    }
    for (const p of posten) if (!p.start && start) p.start = start
    if (ai.analyse) opmerkingen.push(`Wat het contract zegt over facturatie: ${ai.analyse}`)
    if (ai.opmerking) opmerkingen.push(`Uit het contract: ${ai.opmerking}`)
  } else if (freq === 'eenmalig' || (!freq && String(c.duration_type ?? '') === 'eenmalig')) {
    posten = [{ naam, soort: 'eenmalig', frequentie: 'eenmalig', bedrag: perFactuur ?? waarde, perioden: 1, start, inbegrepen: [] }]
  } else if (freq) {
    const n = aantal !== null && aantal > 0 ? Math.round(aantal) : duur ? Math.ceil(duur / perFreq(freq)) : null
    const bedrag = perFactuur ?? (waarde !== null && n ? Math.round((waarde / n) * 100) / 100 : null)
    if (perFactuur === null && bedrag !== null) opmerkingen.push(`Bedrag per factuur afgeleid: contractwaarde ÷ ${n}.`)
    posten = [{ naam, soort: 'terugkerend', frequentie: freq, bedrag, perioden: n, start, inbegrepen: [] }]
  } else if (waarde !== null && waarde > 0 && !duur) {
    posten = [{ naam, soort: 'eenmalig', frequentie: 'eenmalig', bedrag: waarde, perioden: 1, start, inbegrepen: [] }]
    opmerkingen.push('Geen frequentie of looptijd gevonden: als één factuur gepland.')
  } else {
    posten = []
  }

  // Klopt het met de contractwaarde die het team bevestigde?
  if (waarde !== null && waarde > 0 && posten.length) {
    const som = posten.reduce((s, p) => s + (p.bedrag ?? 0) * (p.soort === 'eenmalig' ? 1 : (p.perioden ?? 0)), 0)
    if (som > 0 && Math.abs(som - waarde) > Math.max(1, waarde * 0.01)) opmerkingen.push(`Samen € ${Math.round(som * 100) / 100} excl. btw, de contractwaarde is € ${waarde}. Kijk na welke klopt.`)
  }

  const buitenland = !!klantBtw && /^[A-Z]{2}/i.test(klantBtw.trim()) && !/^BE/i.test(klantBtw.trim())
  const btwPct = ai?.btwPct ?? (buitenland ? 0 : 21)
  if (buitenland && (ai?.btwPct ?? null) === null) opmerkingen.push('Klant buiten België: 0% btw (verlegd). Kijk dat na.')
  return { posten, btwPct, moment: ai?.moment ?? 'eerste', opmerkingen }
}
