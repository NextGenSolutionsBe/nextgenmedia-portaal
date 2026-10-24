// De pure kern van "kosten en winst per factuur". GEEN 'server-only', geen
// databank: alles rekent op wat je meegeeft, zodat het los testbaar is en
// browser én server exact dezelfde cijfers krijgen.
//
// Uitgangspunt: de klantfactuur (bedrag excl./incl. btw) blijft wat ze is.
// Daaronder ligt een interne laag: factuurlijnen met een classificatie, en
// directe kosten die we voor de klant maakten. Winst = verkoop excl. btw −
// directe kosten excl. btw. Btw is nooit omzet, kost of winst.
//
// Afronden gebeurt pas op het einde (twee decimalen); onderweg wordt met de
// volle precisie gerekend, zodat afrondingsverschillen zich niet opstapelen.

export type Classificatie = 'dienst' | 'doorgerekende_kost' | 'gemengd'
export const CLASSIFICATIE_LABEL: Record<Classificatie, string> = {
  dienst: 'Dienst / omzet', doorgerekende_kost: 'Doorgerekende kost', gemengd: 'Gemengd: kost met winstmarge',
}

export type KostenStatus = 'volledig' | 'voorlopig' | 'controle_vereist' | 'geen_directe_kosten' | 'ongecontroleerd'
export const KOSTEN_STATUS_LABEL: Record<KostenStatus, string> = {
  volledig: 'Volledig', voorlopig: 'Voorlopig', controle_vereist: 'Controle vereist',
  geen_directe_kosten: 'Geen directe kosten', ongecontroleerd: 'Nog niet gecontroleerd',
}

export type Lijn = {
  id: string; volgnr: number; omschrijving: string; aantal: number; prijs_excl: number; btw_pct: number
  classificatie: Classificatie; opmerking: string | null
}
export type Kost = {
  id: string; line_id: string | null; omschrijving: string; categorie: string | null; leverancier: string | null
  /** null = kostprijs nog aan te vullen; telt NIET als €0. */
  kostprijs_excl: number | null
  datum: string | null; bewijs_url: string | null; opmerking: string | null
  status: 'actief' | 'geannuleerd'
}

export type FactuurInvoer = {
  omzet_excl: number
  btw_pct: number
  omzet_incl?: number | null
  omschrijving: string | null
  /** Factuurstatus (te_versturen / verstuurd / geannuleerd). */
  factuurstatus: string
  lijnen: Lijn[]
  kosten: Kost[]
  geenDirecteKostenBevestigd: boolean
}

export type LijnBerekend = Lijn & {
  /** aantal × prijs excl. btw. */
  verkoop: number
  /** Som van de gekoppelde kosten met bekende kostprijs. */
  kosten: number
  /** Er hangt een kost aan zonder kostprijs, of het is een kostenlijn zonder kost. */
  kostenOnbekend: boolean
  /** verkoop − kosten. */
  winst: number
}

export type FactuurKostenWinst = {
  omzetExcl: number; btw: number; omzetIncl: number
  /** Som van alle actieve kosten met bekende kostprijs, excl. btw. */
  directeKosten: number
  aantalKosten: number
  /** Aantal actieve kosten zonder kostprijs. */
  kostenOnbekend: number
  /** Brutowinst: omzet excl. − directe kosten. Kan negatief zijn. */
  winst: number
  /** winst ÷ omzet; null bij €0 omzet. */
  margePct: number | null
  /** Wat meetelt voor het vesting-/investeringsprincipe: de winst. */
  vestingWaarde: number
  /** Wat niet meetelt: de doorgerekende (directe) kosten. */
  nietMeetellend: number
  status: KostenStatus
  waarschuwingen: string[]
  perLijn: LijnBerekend[]
  /** Som van de lijnen, als er lijnen zijn; anders null. */
  lijnenTotaal: number | null
  geannuleerd: boolean
}

export const rond2 = (x: number): number => Math.round((x + Number.EPSILON) * 100) / 100
const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0 }

// ── Automatische herkenning ──────────────────────────────────────────────────
//
// Trefwoorden stellen een classificatie VOOR; de gebruiker beslist. Ze worden
// ook gebruikt om te waarschuwen bij een vermoedelijke kostenlijn zonder kost.

export const KOSTEN_CATEGORIEEN: { categorie: string; woorden: string[] }[] = [
  { categorie: 'Hosting', woorden: ['hosting', 'webhosting', 'server', 'framer', 'webflow', 'wix', 'vercel'] },
  { categorie: 'Domeinnaam', woorden: ['domein', 'domeinnaam', 'domain', 'dns', '.be', '.com', '.nl', '.eu'] },
  { categorie: 'Licentie', woorden: ['licentie', 'license', 'licence', 'abonnement', 'subscription', 'plugin', 'template', 'theme', 'font', 'stockfoto', 'stock'] },
  { categorie: 'Software', woorden: ['software', 'saas', 'tool', 'canva', 'adobe', 'figma', 'metricool', 'clickup', 'mailchimp', 'hubspot', 'notion', 'zapier', 'make.com'] },
  { categorie: 'Drukwerk', woorden: ['drukwerk', 'druk', 'print', 'printen', 'flyer', 'flyers', 'visitekaart', 'banner', 'sticker', 'brochure', 'folder', 'affiche', 'poster', 'spandoek'] },
  { categorie: 'Advertentiebudget', woorden: ['advertentiebudget', 'ad spend', 'adspend', 'ads budget', 'advertentiekost', 'mediabudget', 'ad budget', 'boost', 'boosting', 'promotiebudget', 'campagnebudget'] },
  { categorie: 'Verplaatsing', woorden: ['verplaatsing', 'verplaatsingskost', 'kilometer', 'km-vergoeding', 'kilometervergoeding', 'reiskost', 'parking', 'brandstof'] },
  { categorie: 'Freelancer', woorden: ['freelancer', 'freelance', 'onderaannemer', 'onderaanneming', 'externe', 'extern', 'inhuur', 'videograaf', 'fotograaf', 'copywriter', 'vertaler', 'stemacteur', 'voice-over'] },
  { categorie: 'Materiaal', woorden: ['materiaal', 'materialen', 'props', 'decor', 'benodigdheden', 'apparatuur', 'huur', 'verhuur'] },
  { categorie: 'Aankoop leverancier', woorden: ['aankoop', 'aankopen', 'leverancier', 'inkoop', 'doorrekening', 'doorgerekend', 'doorgerekende', 'voorgeschoten', 'voorschot leverancier', 'verzendkost', 'verzending', 'porto'] },
]

export const DIENST_TREFWOORDEN = [
  'websiteontwikkeling', 'website ontwikkeling', 'webdesign', 'webdevelopment', 'ontwikkeling', 'development', 'design', 'ontwerp', 'huisstijl', 'logo',
  'social media', 'socials', 'content', 'contentcreatie', 'community', 'strategie', 'consultancy', 'advies', 'coaching', 'workshop', 'training',
  'fotografie', 'fotoshoot', 'videografie', 'video', 'montage', 'editing', 'reel', 'reels', 'campagnebeheer', 'advertentiebeheer', 'ads beheer', 'seo', 'copywriting', 'tekst', 'beheer', 'onderhoud', 'maintenance', 'management', 'setup', 'opzet', 'uurtarief', 'uren', 'projectbegeleiding',
]

const normaliseer = (s: string) => ` ${s.toLowerCase().replace(/[^a-z0-9.À-ſ]+/g, ' ').trim()} `

/** Welke kostencategorie klinkt door in deze omschrijving? null = geen. */
export function vermoedelijkeKostenlijn(tekst: string | null | undefined): string | null {
  if (!tekst) return null
  const t = normaliseer(tekst)
  for (const k of KOSTEN_CATEGORIEEN) {
    for (const w of k.woorden) {
      // Domeinextensies (.be, .com) enkel als deel van een woord; andere woorden als los woord of als voorvoegsel (hosting → hostingpakket).
      if (w.startsWith('.')) { if (t.includes(w)) return k.categorie; continue }
      if (t.includes(` ${w}`) || t.includes(`${w} `)) return k.categorie
    }
  }
  return null
}

export function isDienstomschrijving(tekst: string | null | undefined): boolean {
  if (!tekst) return false
  const t = normaliseer(tekst)
  return DIENST_TREFWOORDEN.some((w) => t.includes(` ${w}`) || t.includes(`${w} `))
}

export type ClassificatieVoorstel = { classificatie: Classificatie; categorie: string | null; reden: string }

/**
 * Voorstel voor een nieuwe lijn. Een kostenwoord wint van een dienstwoord
 * ("hosting website" is hosting), maar "beheer van de advertenties" blijft
 * een dienst zolang er geen budgetwoord in staat. Altijd aanpasbaar.
 */
export function stelClassificatieVoor(omschrijving: string | null | undefined): ClassificatieVoorstel {
  const categorie = vermoedelijkeKostenlijn(omschrijving)
  if (categorie) return { classificatie: 'doorgerekende_kost', categorie, reden: `Herkend als ${categorie.toLowerCase()} — controleer en pas aan als het een dienst met marge is.` }
  if (isDienstomschrijving(omschrijving)) return { classificatie: 'dienst', categorie: null, reden: 'Herkend als dienst.' }
  return { classificatie: 'dienst', categorie: null, reden: 'Niet herkend; standaard dienst.' }
}

// ── De berekening ────────────────────────────────────────────────────────────

export function berekenKostenWinst(f: FactuurInvoer): FactuurKostenWinst {
  const geannuleerd = f.factuurstatus === 'geannuleerd'
  const omzetExcl = n(f.omzet_excl)
  const btw = f.omzet_incl !== null && f.omzet_incl !== undefined ? n(f.omzet_incl) - omzetExcl : omzetExcl * n(f.btw_pct) / 100
  const omzetIncl = omzetExcl + btw
  const actief = f.kosten.filter((k) => k.status === 'actief')
  const waarschuwingen: string[] = []

  // Per lijn: verkoop en de kosten die eraan hangen.
  const perLijn: LijnBerekend[] = [...f.lijnen].sort((a, b) => a.volgnr - b.volgnr).map((l) => {
    const eigen = actief.filter((k) => k.line_id === l.id)
    const bekend = eigen.filter((k) => k.kostprijs_excl !== null)
    const kosten = bekend.reduce((s, k) => s + n(k.kostprijs_excl), 0)
    const verkoop = n(l.aantal) * n(l.prijs_excl)
    // Een kostenlijn zonder enige kost: de kostprijs ontbreekt nog.
    const kostenOnbekend = eigen.length !== bekend.length || (l.classificatie !== 'dienst' && eigen.length === 0)
    return { ...l, verkoop, kosten, kostenOnbekend, winst: verkoop - kosten }
  })
  const lijnenTotaal = perLijn.length ? perLijn.reduce((s, l) => s + l.verkoop, 0) : null

  // Op factuurniveau: elke actieve kost telt precies één keer (aan een lijn of los).
  const bekend = actief.filter((k) => k.kostprijs_excl !== null)
  const directeKosten = bekend.reduce((s, k) => s + n(k.kostprijs_excl), 0)
  const kostenOnbekend = actief.length - bekend.length
  const winst = omzetExcl - directeKosten
  const margePct = omzetExcl > 0 ? winst / omzetExcl : null

  // ── Status en waarschuwingen ──
  let status: KostenStatus
  const kostenlijnenZonderKost = perLijn.filter((l) => l.classificatie !== 'dienst' && !actief.some((k) => k.line_id === l.id))
  const vermoedelijk = perLijn.length === 0 ? vermoedelijkeKostenlijn(f.omschrijving) : null
  const dubbels = mogelijkeDubbels(actief)

  if (kostenOnbekend > 0) waarschuwingen.push(`${kostenOnbekend} kost${kostenOnbekend > 1 ? 'en' : ''} zonder kostprijs — de winst is voorlopig.`)
  for (const l of kostenlijnenZonderKost) waarschuwingen.push(`Lijn "${l.omschrijving}" is een ${CLASSIFICATIE_LABEL[l.classificatie].toLowerCase()} zonder gekoppelde kost.`)
  if (vermoedelijk && actief.length === 0 && !f.geenDirecteKostenBevestigd) waarschuwingen.push(`Omschrijving lijkt op ${vermoedelijk.toLowerCase()} — er is nog geen kostprijs gekoppeld.`)
  if (directeKosten > omzetExcl && omzetExcl > 0) waarschuwingen.push(`De directe kosten (${rond2(directeKosten)}) zijn hoger dan de verkoopwaarde (${rond2(omzetExcl)}).`)
  if (dubbels.length) waarschuwingen.push(`Mogelijk dubbel gekoppeld: ${dubbels.join(', ')}.`)
  if (lijnenTotaal !== null && Math.abs(lijnenTotaal - omzetExcl) > 0.005) waarschuwingen.push(`De lijnen tellen op tot ${rond2(lijnenTotaal)}, de factuur staat op ${rond2(omzetExcl)}.`)
  if (f.geenDirecteKostenBevestigd && actief.length > 0) waarschuwingen.push('Er is bevestigd dat er geen directe kosten zijn, maar er hangen wél kosten aan deze factuur.')
  for (const l of perLijn) if (l.winst < 0) waarschuwingen.push(`Negatieve marge op lijn "${l.omschrijving}" (${rond2(l.winst)}).`)

  const controle = (directeKosten > omzetExcl && omzetExcl > 0) || dubbels.length > 0
    || (lijnenTotaal !== null && Math.abs(lijnenTotaal - omzetExcl) > 0.005)
    || (!!vermoedelijk && actief.length === 0 && !f.geenDirecteKostenBevestigd)
    || (f.geenDirecteKostenBevestigd && actief.length > 0)
  if (controle) status = 'controle_vereist'
  else if (kostenOnbekend > 0 || kostenlijnenZonderKost.length > 0) status = 'voorlopig'
  else if (actief.length > 0) status = 'volledig'
  else if (f.geenDirecteKostenBevestigd) status = 'geen_directe_kosten'
  else status = 'ongecontroleerd'

  if (geannuleerd) {
    // Een geannuleerde factuur telt nergens in mee; de kostengegevens blijven bewaard.
    return {
      omzetExcl: 0, btw: 0, omzetIncl: 0, directeKosten: 0, aantalKosten: actief.length, kostenOnbekend, winst: 0, margePct: null,
      vestingWaarde: 0, nietMeetellend: 0, status, waarschuwingen: ['Factuur is geannuleerd; telt niet mee.'], perLijn, lijnenTotaal, geannuleerd: true,
    }
  }
  return {
    omzetExcl: rond2(omzetExcl), btw: rond2(btw), omzetIncl: rond2(omzetIncl),
    directeKosten: rond2(directeKosten), aantalKosten: actief.length, kostenOnbekend,
    winst: rond2(winst), margePct: margePct === null ? null : Math.round(margePct * 10000) / 10000,
    vestingWaarde: rond2(winst), nietMeetellend: rond2(directeKosten),
    status, waarschuwingen, perLijn: perLijn.map((l) => ({ ...l, verkoop: rond2(l.verkoop), kosten: rond2(l.kosten), winst: rond2(l.winst) })),
    lijnenTotaal: lijnenTotaal === null ? null : rond2(lijnenTotaal), geannuleerd: false,
  }
}

/** Twee actieve kosten met dezelfde omschrijving én hetzelfde bedrag op één factuur. */
export function mogelijkeDubbels(kosten: Kost[]): string[] {
  const gezien = new Map<string, number>()
  const uit: string[] = []
  for (const k of kosten) {
    if (k.status !== 'actief' || k.kostprijs_excl === null) continue
    const sleutel = `${normaliseer(k.omschrijving).trim()}|${rond2(n(k.kostprijs_excl))}`
    const aantal = (gezien.get(sleutel) ?? 0) + 1
    gezien.set(sleutel, aantal)
    if (aantal === 2) uit.push(`"${k.omschrijving}" (${rond2(n(k.kostprijs_excl))})`)
  }
  return uit
}

/** Samenvatting over meerdere facturen (bv. alle facturen van één contract). */
export function telSamen(items: FactuurKostenWinst[]): { omzetExcl: number; directeKosten: number; winst: number; kostenOnbekend: number; status: KostenStatus } {
  const levend = items.filter((i) => !i.geannuleerd)
  const omzetExcl = levend.reduce((s, i) => s + i.omzetExcl, 0)
  const directeKosten = levend.reduce((s, i) => s + i.directeKosten, 0)
  const rang: Record<KostenStatus, number> = { controle_vereist: 0, voorlopig: 1, ongecontroleerd: 2, volledig: 3, geen_directe_kosten: 4 }
  let status: KostenStatus = 'geen_directe_kosten'
  if (levend.length === 0) status = 'geen_directe_kosten'
  else status = levend.map((i) => i.status).sort((a, b) => rang[a] - rang[b])[0]
  return { omzetExcl: rond2(omzetExcl), directeKosten: rond2(directeKosten), winst: rond2(omzetExcl - directeKosten), kostenOnbekend: levend.reduce((s, i) => s + i.kostenOnbekend, 0), status }
}
