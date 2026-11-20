/**
 * Offertes opmaken in de app — pure module (browser en server).
 *
 * Werkwijze: klant kiezen → algemene gegevens → enkel de fiches van de
 * diensten die je aanbiedt → prijsblok. Uit die keuzes maakt de server een
 * nette pdf (lib/offerte-pdf.ts). Elke fiche heeft vaste velden, zodat je voor
 * bv. social media altijd dezelfde vragen invult, maar telkens een ander
 * pakket, aantal posts of looptijd kiest.
 *
 * Waarden zijn tekst (ook getallen en bedragen, zoals ze getypt werden),
 * "ja"/"nee" of een lijst gekozen opties. Zo blijft wat de klant krijgt exact
 * wat er ingevuld werd.
 */

export type VeldSoort = 'tekst' | 'lang' | 'getal' | 'bedrag' | 'datum' | 'janee' | 'keuzes' | 'keuze'

export type Veld = {
  key: string
  label: string
  soort: VeldSoort
  /** Hint in het lege veld. */
  ph?: string
  /** Achter een getal of bedrag: "maanden", "per maand". */
  eenheid?: string
  /** Keuzes en keuze: de vaste opties (er is altijd ook "andere"). */
  opties?: string[]
  /** Ja/nee: extra vraag als het "ja" is (bv. welke kanalen, frequentie). */
  bijJa?: Veld
  /** Ja/nee dat geen "inbegrepen" is maar een feit (bv. verplaatsingskosten van toepassing). */
  feit?: boolean
  /** Breed veld in het formulier. */
  breed?: boolean
}

export type DienstFiche = { key: DienstFicheKey; titel: string; kort: string; velden: Veld[] }

export type DienstFicheKey = 'social_media' | 'video_foto' | 'website' | 'ads' | 'seo' | 'branding' | 'email' | 'consultancy' | 'ai'

const nietInbegrepen = (ph = 'Bv. advertentiebudget, drukwerk, extra draaidagen'): Veld => ({ key: 'niet_inbegrepen', label: 'Niet inbegrepen', soort: 'lang', ph, breed: true })
const rapportering: Veld = { key: 'rapportering', label: 'Rapportering', soort: 'janee', bijJa: { key: 'rapportering_freq', label: 'Frequentie', soort: 'tekst', ph: 'Bv. maandelijks' } }

/** 1. Algemene klant- en offertegegevens. De klant zelf kies je bovenaan. */
export const ALGEMEEN: Veld[] = [
  { key: 'contactpersoon', label: 'Contactpersoon', soort: 'tekst' },
  { key: 'email', label: 'E-mailadres', soort: 'tekst' },
  { key: 'telefoon', label: 'Telefoonnummer', soort: 'tekst' },
  { key: 'offertenummer', label: 'Offertenummer', soort: 'tekst' },
  { key: 'datum', label: 'Datum offerte', soort: 'datum' },
  { key: 'geldig_tot', label: 'Geldig tot', soort: 'datum' },
  { key: 'projectnaam', label: 'Projectnaam', soort: 'tekst', ph: 'Bv. Social media 2027', breed: true },
  { key: 'doel', label: 'Doel van de opdracht', soort: 'lang', ph: 'Wat wil de klant bereiken?', breed: true },
  { key: 'startdatum', label: 'Gevraagde startdatum', soort: 'tekst', ph: 'Bv. 1 januari 2027' },
  { key: 'looptijd', label: 'Looptijd of einddatum', soort: 'tekst', ph: 'Bv. 12 maanden' },
  { key: 'feedback_contact', label: 'Contactpersoon voor feedback en goedkeuring', soort: 'tekst', breed: true },
]

export const DIENST_FICHES: DienstFiche[] = [
  {
    key: 'social_media', titel: 'Social media beheer', kort: 'sociale media',
    velden: [
      { key: 'pakket', label: 'Gekozen pakket', soort: 'tekst', ph: 'Bv. Pakket Groei' },
      { key: 'looptijd', label: 'Looptijd', soort: 'getal', eenheid: 'maanden' },
      { key: 'kanalen', label: 'Kanalen', soort: 'keuzes', opties: ['Instagram', 'Facebook', 'LinkedIn', 'TikTok'], breed: true },
      { key: 'posts', label: 'Posts per maand', soort: 'getal' },
      { key: 'reels', label: "Reels/video's per maand", soort: 'getal' },
      { key: 'stories', label: 'Stories per maand', soort: 'getal' },
      { key: 'draaidagen', label: 'Draaidagen', soort: 'tekst', ph: 'Bv. 1 per maand' },
      { key: 'community', label: 'Community management', soort: 'janee', bijJa: { key: 'community_detail', label: 'Welke kanalen en hoeveel opvolging?', soort: 'tekst', ph: 'Bv. Instagram en Facebook, elke werkdag' } },
      { key: 'planning', label: 'Contentplanning', soort: 'janee' },
      rapportering,
      { key: 'strategie', label: 'Strategie en overleg', soort: 'janee', bijJa: { key: 'strategie_freq', label: 'Frequentie', soort: 'tekst', ph: 'Bv. elk kwartaal' } },
      { key: 'ads_beheer', label: 'Advertentiebeheer', soort: 'janee', bijJa: { key: 'ads_kanalen', label: 'Kanalen', soort: 'tekst', ph: 'Bv. Meta' } },
      { key: 'ads_budget', label: 'Advertentiebudget', soort: 'janee', bijJa: { key: 'ads_budget_bedrag', label: 'Bedrag per maand', soort: 'bedrag', eenheid: 'per maand' } },
      { key: 'feedbackrondes', label: 'Feedbackrondes per contentstuk', soort: 'getal' },
      { key: 'aanleveren', label: 'Wat de klant aanlevert', soort: 'lang', ph: "Bv. logo, huisstijl, toegang tot de accounts", breed: true },
      nietInbegrepen(),
    ],
  },
  {
    key: 'video_foto', titel: 'Video en fotografie', kort: 'video en foto',
    velden: [
      { key: 'type', label: 'Type opdracht', soort: 'keuzes', opties: ['Reels', 'Bedrijfsvideo', 'Aftermovie', "Productfoto's", 'Bedrijfsfotografie'], breed: true },
      { key: 'videos', label: "Aantal video's", soort: 'getal' },
      { key: 'fotos', label: "Aantal foto's of afgewerkte beelden", soort: 'getal' },
      { key: 'draaidagen', label: 'Aantal draaidagen', soort: 'getal' },
      { key: 'duur_draaidag', label: 'Duur per draaidag', soort: 'tekst', ph: 'Bv. halve dag (4 uur)' },
      { key: 'locaties', label: 'Locatie(s)', soort: 'tekst' },
      { key: 'in_beeld', label: 'Wie verschijnt in beeld?', soort: 'tekst' },
      { key: 'formaten', label: 'Formaten', soort: 'keuzes', opties: ['9:16', '16:9', '1:1'], breed: true },
      { key: 'revisies', label: 'Revisierondes', soort: 'getal' },
      { key: 'script', label: 'Script of concept', soort: 'janee' },
      { key: 'ondertiteling', label: 'Ondertiteling', soort: 'janee' },
      { key: 'ruwe_beelden', label: 'Ruwe beelden', soort: 'janee' },
      { key: 'muziek', label: 'Muzieklicentie', soort: 'janee' },
      { key: 'presentator', label: 'Presentator, acteur of voice-over nodig', soort: 'janee', feit: true, bijJa: { key: 'presentator_wie', label: 'Wie regelt dit?', soort: 'tekst' } },
      { key: 'huur', label: 'Huurmateriaal, studio of locatiekosten nodig', soort: 'janee', feit: true, bijJa: { key: 'huur_welke', label: 'Welke?', soort: 'tekst' } },
      { key: 'verplaatsing', label: 'Verplaatsingskosten van toepassing', soort: 'janee', feit: true },
      { key: 'publicatie', label: 'Publicatie of advertentiegebruik voorzien', soort: 'janee', feit: true },
      nietInbegrepen(),
    ],
  },
  {
    key: 'website', titel: 'Website of landingspagina', kort: 'website',
    velden: [
      { key: 'type', label: 'Type', soort: 'keuzes', opties: ['Nieuwe website', 'Redesign', 'Landingspagina', 'Webshop'], breed: true },
      { key: 'paginas', label: "Aantal pagina's", soort: 'getal' },
      { key: 'talen', label: 'Talen', soort: 'tekst', ph: 'Bv. Nederlands en Frans' },
      { key: 'paginas_lijst', label: "Pagina's inbegrepen", soort: 'lang', ph: 'Bv. Home, Over ons, Diensten, Contact', breed: true },
      { key: 'platform', label: 'Platform', soort: 'keuzes', opties: ['WordPress', 'Wix', 'Shopify', 'Odoo'], breed: true },
      { key: 'functies', label: 'Functies', soort: 'keuzes', opties: ['Contactformulier', 'Boekingen', 'Webshop', 'Betalingen', 'Koppelingen'], breed: true },
      { key: 'revisies', label: 'Revisierondes', soort: 'getal' },
      { key: 'teksten', label: 'Teksten', soort: 'janee' },
      { key: 'beeld', label: 'Fotografie of video', soort: 'janee' },
      { key: 'seo', label: 'SEO-basis', soort: 'janee' },
      { key: 'mobiel', label: 'Mobiele optimalisatie', soort: 'janee' },
      { key: 'domein', label: 'Domeinnaam', soort: 'janee' },
      { key: 'hosting', label: 'Hosting', soort: 'janee', bijJa: { key: 'hosting_detail', label: 'Periode en prijs', soort: 'tekst', ph: 'Bv. 12 maanden, € 25 per maand' } },
      { key: 'licenties', label: 'Licenties of betaalde plugins nodig', soort: 'janee', feit: true, bijJa: { key: 'licenties_detail', label: 'Welke en wie betaalt?', soort: 'tekst' } },
      { key: 'onderhoud', label: 'Onderhoud na oplevering', soort: 'janee', bijJa: { key: 'onderhoud_periode', label: 'Periode', soort: 'tekst', ph: 'Bv. 12 maanden' } },
      nietInbegrepen('Bv. teksten, fotografie, betaalde plugins'),
    ],
  },
  {
    key: 'ads', titel: 'Meta Ads- of Google Ads-beheer', kort: 'advertenties',
    velden: [
      { key: 'platform', label: 'Platform', soort: 'keuzes', opties: ['Meta', 'Google', 'LinkedIn', 'TikTok'], breed: true },
      { key: 'doel', label: 'Doel', soort: 'keuzes', opties: ['Leads', 'Verkoop', 'Verkeer', 'Bereik', 'Sollicitaties'], breed: true },
      { key: 'campagnes', label: 'Aantal campagnes', soort: 'getal' },
      { key: 'adsets', label: 'Advertentiesets of ad groups', soort: 'getal' },
      { key: 'ads', label: 'Advertenties of varianten', soort: 'getal' },
      { key: 'periode', label: 'Beheerperiode', soort: 'getal', eenheid: 'maanden' },
      { key: 'vergoeding', label: 'Beheervergoeding', soort: 'bedrag', eenheid: 'per maand' },
      { key: 'budget', label: 'Advertentiebudget', soort: 'bedrag', eenheid: 'per maand' },
      { key: 'budget_wie', label: 'Wie betaalt het advertentiebudget?', soort: 'tekst', ph: 'Bv. de klant, rechtstreeks aan Meta' },
      { key: 'optimalisatie', label: 'Optimalisatie- of overlegmomenten', soort: 'getal' },
      { key: 'opzet', label: 'Eenmalige campagne-opzet', soort: 'janee' },
      { key: 'creatie', label: 'Advertentiecreatie', soort: 'janee', bijJa: { key: 'creatie_aantal', label: "Aantal beelden, video's en teksten", soort: 'tekst' } },
      { key: 'tracking', label: 'Tracking of pixelconfiguratie', soort: 'janee' },
      { key: 'leadform', label: 'Leadformulier of landingspagina', soort: 'janee' },
      rapportering,
      nietInbegrepen('Bv. advertentiebudget, landingspagina'),
    ],
  },
  {
    key: 'seo', titel: 'SEO en vindbaarheid', kort: 'SEO',
    velden: [
      { key: 'type', label: 'Type', soort: 'keuzes', opties: ['Eenmalige SEO-audit', 'Maandelijkse SEO', 'Lokale SEO', 'SEO voor AI-zoekresultaten'], breed: true },
      { key: 'looptijd', label: 'Looptijd', soort: 'getal', eenheid: 'maanden' },
      { key: 'paginas', label: "Pagina's of diensten waarop we werken", soort: 'getal' },
      { key: 'toegang', label: 'Toegang nodig tot', soort: 'keuzes', opties: ['Website', 'Google Search Console', 'Analytics'], breed: true },
      { key: 'technisch', label: 'Technische SEO', soort: 'janee' },
      { key: 'zoekwoorden', label: 'Zoekwoordenonderzoek', soort: 'janee' },
      { key: 'content', label: 'Content of webteksten', soort: 'janee', bijJa: { key: 'content_aantal', label: 'Aantal per maand', soort: 'tekst' } },
      { key: 'lokaal', label: 'Lokale SEO', soort: 'janee' },
      { key: 'bedrijfsprofiel', label: 'Google Bedrijfsprofiel', soort: 'janee' },
      rapportering,
      nietInbegrepen('Bv. webteksten, technische aanpassingen aan de website'),
    ],
  },
  {
    key: 'branding', titel: 'Branding en grafisch ontwerp', kort: 'grafisch ontwerp',
    velden: [
      { key: 'type', label: 'Type opdracht', soort: 'keuzes', opties: ['Logo', 'Brand guide', 'Rebranding', 'Campagnevisuals', 'Drukwerk'], breed: true },
      { key: 'onderdelen', label: 'Onderdelen inbegrepen', soort: 'lang', ph: 'Bv. logo, kleurenpalet, typografie, visitekaartje', breed: true },
      { key: 'concepten', label: 'Eerste concepten', soort: 'getal' },
      { key: 'revisies', label: 'Revisierondes', soort: 'getal' },
      { key: 'formaten', label: 'Bestandsformaten', soort: 'tekst', ph: 'Bv. svg, pdf, png, ai' },
      { key: 'drukwerk', label: 'Drukwerk', soort: 'janee' },
      { key: 'drukkosten', label: 'Druk- of productiekosten', soort: 'janee' },
      { key: 'bronbestanden', label: 'Bronbestanden', soort: 'janee' },
      nietInbegrepen('Bv. druk- en productiekosten'),
    ],
  },
  {
    key: 'email', titel: 'E-mailmarketing', kort: 'e-mailmarketing',
    velden: [
      { key: 'type', label: 'Type', soort: 'keuzes', opties: ['Strategie', 'Nieuwsbrief', 'Automatisatie', 'Campagnebeheer'], breed: true },
      { key: 'platform', label: 'Platform', soort: 'keuzes', opties: ['Mailchimp', 'Brevo', 'HubSpot', 'Odoo'], breed: true },
      { key: 'looptijd', label: 'Looptijd', soort: 'getal', eenheid: 'maanden' },
      { key: 'campagnes', label: 'Campagnes per maand', soort: 'getal' },
      { key: 'automatisaties', label: 'Aantal automatisaties', soort: 'getal' },
      { key: 'teksten', label: 'Teksten', soort: 'janee' },
      { key: 'ontwerp', label: 'Ontwerp', soort: 'janee' },
      { key: 'segmentatie', label: 'Lijstsegmentatie', soort: 'janee' },
      { key: 'platformkosten', label: 'Platform- of verzendkosten', soort: 'janee' },
      rapportering,
      nietInbegrepen(),
    ],
  },
  {
    key: 'consultancy', titel: 'Strategie of consultancy', kort: 'consultancy',
    velden: [
      { key: 'onderwerp', label: 'Onderwerp', soort: 'keuzes', opties: ['Marketingstrategie', 'Contentstrategie', 'Social media', 'Advertenties', 'AI'], breed: true },
      { key: 'sessies', label: 'Aantal sessies', soort: 'getal' },
      { key: 'duur', label: 'Duur per sessie', soort: 'tekst', ph: 'Bv. 2 uur' },
      { key: 'voorbereiding', label: 'Voorbereiding of audit', soort: 'janee' },
      { key: 'document', label: 'Strategiedocument of actieplan', soort: 'janee' },
      { key: 'opvolging', label: 'Opvolging na de sessies', soort: 'janee', bijJa: { key: 'opvolging_aantal', label: 'Aantal opvolgmomenten', soort: 'tekst' } },
      { key: 'uitvoering', label: 'Uitvoering van de aanbevelingen', soort: 'janee' },
      nietInbegrepen('Bv. uitvoering van de aanbevelingen'),
    ],
  },
  {
    key: 'ai', titel: 'AI en automatisaties', kort: 'AI-automatisatie',
    velden: [
      { key: 'wat', label: 'Wat we bouwen of automatiseren', soort: 'lang', breed: true },
      { key: 'tools', label: 'Tools of platformen', soort: 'tekst', ph: 'Bv. Make, n8n, OpenAI, HubSpot' },
      { key: 'workflows', label: 'Aantal workflows of automatisaties', soort: 'getal' },
      { key: 'koppelingen', label: 'Koppelingen met andere systemen', soort: 'tekst', breed: true },
      { key: 'kosten', label: 'Abonnementen, credits of gebruikskosten', soort: 'keuze', opties: ['Inbegrepen', 'Apart', 'Door klant betaald'], breed: true },
      { key: 'setup', label: 'Eenmalige setup', soort: 'janee' },
      { key: 'testing', label: 'Testing en opleiding', soort: 'janee' },
      { key: 'onderhoud', label: 'Onderhoud of opvolging', soort: 'janee', bijJa: { key: 'onderhoud_periode', label: 'Periode', soort: 'tekst' } },
      nietInbegrepen('Bv. abonnementen van externe tools'),
    ],
  },
]

/** Dienst op de projectkaart (lib/opdrachten-kanban DIENSTEN) per fiche. */
export const FICHE_NAAR_DIENST: Record<DienstFicheKey, string> = {
  social_media: 'social_media', video_foto: 'foto_video', website: 'webdesign', ads: 'advertising', seo: 'webdesign',
  branding: 'grafisch', email: 'consultancy', consultancy: 'consultancy', ai: 'ngs',
}

/** 11. Prijs- en kostenblok. */
export const PRIJS: Veld[] = [
  { key: 'setup', label: 'Eenmalige setup of opstart', soort: 'bedrag' },
  { key: 'maandelijks', label: 'Maandelijkse vergoeding', soort: 'bedrag', eenheid: 'per maand' },
  { key: 'maanden', label: 'Aantal maanden', soort: 'getal' },
  { key: 'advertentiebudget', label: 'Advertentiebudget', soort: 'bedrag' },
  { key: 'budget_via_ons', label: 'Advertentiebudget via ons gefactureerd', soort: 'janee', feit: true },
  { key: 'verplaatsing', label: 'Kilometer- of verplaatsingskosten', soort: 'bedrag' },
  { key: 'huur', label: 'Huurmateriaal of locatiekosten', soort: 'bedrag' },
  { key: 'licenties', label: 'Licenties, tools of AI-kosten', soort: 'bedrag' },
  { key: 'extern', label: 'Andere externe kosten', soort: 'bedrag' },
  { key: 'btw', label: 'Btw', soort: 'getal', eenheid: '%' },
  { key: 'betaling', label: 'Betaling in schijven of voorschot', soort: 'lang', ph: 'Bv. 50% bij akkoord, 50% bij oplevering', breed: true },
]

export type Waarden = Record<string, string | string[]>
export type ExtraLijn = { omschrijving: string; bedrag: string }

export type OfferteInhoud = {
  algemeen: Waarden
  /** Gekozen diensten, in de volgorde van de offerte. */
  diensten: DienstFicheKey[]
  fiches: Partial<Record<DienstFicheKey, Waarden>>
  prijs: Waarden
  /** Eigen prijslijnen bovenop het vaste blok. */
  extra: ExtraLijn[]
}

export const VERANTWOORDELIJKEN = ['marco', 'bram'] as const
export type Verantwoordelijke = (typeof VERANTWOORDELIJKEN)[number]
export const isVerantwoordelijke = (v: unknown): v is Verantwoordelijke => v === 'marco' || v === 'bram'

export const ficheVan = (k: string): DienstFiche | undefined => DIENST_FICHES.find((d) => d.key === k)

export function legeInhoud(vandaag: string, geldigTot: string): OfferteInhoud {
  return { algemeen: { datum: vandaag, geldig_tot: geldigTot }, diensten: [], fiches: {}, prijs: { btw: '21' }, extra: [] }
}

// ── Nakijken ────────────────────────────────────────────────────────────────

const tekst = (v: unknown, max: number) => String(v ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim().slice(0, max)

/** Eén veldwaarde netjes maken volgens het veld. Onbekende keuzes blijven (eigen tekst bij "andere" staat apart). */
function schoonVeld(v: Veld, ruw: Waarden, uit: Waarden) {
  const w = ruw[v.key]
  if (v.soort === 'keuzes') {
    const lijst = (Array.isArray(w) ? w : []).map((x) => tekst(x, 80)).filter(Boolean)
    if (lijst.length) uit[v.key] = [...new Set(lijst)].slice(0, 20)
    const andere = tekst(ruw[`${v.key}_andere`], 200)
    if (andere) uit[`${v.key}_andere`] = andere
    return
  }
  if (v.soort === 'keuze') {
    const k = tekst(w, 80)
    if (k) uit[v.key] = k
    const andere = tekst(ruw[`${v.key}_andere`], 200)
    if (andere) uit[`${v.key}_andere`] = andere
    return
  }
  if (v.soort === 'janee') {
    if (w === 'ja' || w === 'nee') uit[v.key] = w
    if (w === 'ja' && v.bijJa) schoonVeld(v.bijJa, ruw, uit)
    return
  }
  const s = tekst(w, v.soort === 'lang' ? 3000 : 300)
  if (s) uit[v.key] = s
}

function schoonSectie(velden: Veld[], ruw: unknown): Waarden {
  const r = (ruw && typeof ruw === 'object' && !Array.isArray(ruw) ? ruw : {}) as Waarden
  const uit: Waarden = {}
  for (const v of velden) schoonVeld(v, r, uit)
  return uit
}

/** Wat het formulier stuurt, nakijken en opkuisen. Lege velden vallen weg. */
export function leesInhoud(b: unknown): OfferteInhoud {
  const r = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
  const diensten = (Array.isArray(r.diensten) ? r.diensten : []).filter((k): k is DienstFicheKey => !!ficheVan(String(k)))
  const uniek = [...new Set(diensten)]
  const fichesRuw = (r.fiches && typeof r.fiches === 'object' ? r.fiches : {}) as Record<string, unknown>
  const fiches: OfferteInhoud['fiches'] = {}
  for (const k of uniek) fiches[k] = schoonSectie(ficheVan(k)!.velden, fichesRuw[k])
  const extra = (Array.isArray(r.extra) ? r.extra : []).slice(0, 20).map((x) => {
    const e = (x ?? {}) as Record<string, unknown>
    return { omschrijving: tekst(e.omschrijving, 200), bedrag: tekst(e.bedrag, 30) }
  }).filter((e) => e.omschrijving || e.bedrag)
  return { algemeen: schoonSectie(ALGEMEEN, r.algemeen), diensten: uniek, fiches, prijs: schoonSectie(PRIJS, r.prijs), extra }
}

// ── Bedragen ────────────────────────────────────────────────────────────────

/** "1.250,50", "1250", "€ 1 250" → 1250.5; leeg of onzin = 0 (de invoer toont dan zelf een fout). */
export function bedragVan(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  let s = String(v ?? '').replace(/[€\s]/g, '')
  if (!s) return 0
  if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  else s = s.replace(',', '.')
  const n = Number(s)
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : 0
}
export const isGeldigBedrag = (v: unknown): boolean => {
  const s = String(v ?? '').replace(/[€\s]/g, '')
  return !s || bedragVan(s) > 0 || /^0+([.,]0+)?$/.test(s)
}
const geheel = (v: unknown): number => { const n = Math.round(Number(String(v ?? '').replace(',', '.'))); return Number.isFinite(n) && n > 0 ? n : 0 }
const rond = (n: number) => Math.round(n * 100) / 100

export type PrijsLijn = { omschrijving: string; detail?: string; bedrag: number }
export type Prijs = {
  lijnen: PrijsLijn[]
  /** Eenmalig + maandelijks × maanden. */
  looptijd: number
  excl: number
  btwPct: number
  btw: number
  incl: number
  /** Advertentiebudget dat de klant zelf betaalt (niet in het totaal). */
  budgetApart: number
  maandelijks: number
  maanden: number
}

/** Het prijsblok uitrekenen: elke lijn, subtotaal, btw en totaal. */
export function berekenPrijs(p: Waarden, extra: ExtraLijn[] = []): Prijs {
  const lijnen: PrijsLijn[] = []
  const setup = bedragVan(p.setup), maand = bedragVan(p.maandelijks), maanden = geheel(p.maanden) || (maand ? 1 : 0)
  if (setup) lijnen.push({ omschrijving: 'Eenmalige setup en opstart', bedrag: setup })
  if (maand) lijnen.push({ omschrijving: 'Maandelijkse vergoeding', detail: `${maanden} ${maanden === 1 ? 'maand' : 'maanden'} × ${euro(maand)}`, bedrag: rond(maand * maanden) })
  const budget = bedragVan(p.advertentiebudget)
  const viaOns = p.budget_via_ons === 'ja'
  if (budget && viaOns) lijnen.push({ omschrijving: 'Advertentiebudget', detail: 'via ons gefactureerd', bedrag: budget })
  for (const [k, l] of [['verplaatsing', 'Kilometer- en verplaatsingskosten'], ['huur', 'Huurmateriaal en locatiekosten'], ['licenties', 'Licenties, tools en AI-kosten'], ['extern', 'Andere externe kosten']] as const) {
    const b = bedragVan(p[k]); if (b) lijnen.push({ omschrijving: l, bedrag: b })
  }
  for (const e of extra) { const b = bedragVan(e.bedrag); if (e.omschrijving || b) lijnen.push({ omschrijving: e.omschrijving || 'Extra', bedrag: b }) }
  const excl = rond(lijnen.reduce((s, l) => s + l.bedrag, 0))
  const pctRuw = Number(String(p.btw ?? '21').replace(',', '.'))
  const btwPct = Number.isFinite(pctRuw) && pctRuw >= 0 && pctRuw <= 100 ? pctRuw : 21
  const btw = rond(excl * btwPct / 100)
  return { lijnen, looptijd: rond(setup + maand * maanden), excl, btwPct, btw, incl: rond(excl + btw), budgetApart: budget && !viaOns ? budget : 0, maandelijks: maand, maanden }
}

export function euro(n: number): string {
  return n.toLocaleString('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })
}

// ── Offertenummer ───────────────────────────────────────────────────────────

const NUMMER = /^OF-(\d{4})-(\d{1,5})$/

/** Volgend nummer van dit jaar: OF-2026-007 → OF-2026-008; in een nieuw jaar OF-2027-001. */
export function volgendOffertenummer(bestaande: (string | null | undefined)[], jaar: number): string {
  let hoogste = 0
  for (const n of bestaande) {
    const m = NUMMER.exec(String(n ?? '').trim().toUpperCase())
    if (m && Number(m[1]) === jaar) hoogste = Math.max(hoogste, Number(m[2]))
  }
  return `OF-${jaar}-${String(hoogste + 1).padStart(3, '0')}`
}

// ── Wat er op de pdf komt ───────────────────────────────────────────────────

export type FicheWeergave = {
  titel: string
  /** Kerngegevens: label + waarde. */
  feiten: [string, string][]
  /** Wat inbegrepen is (met de extra uitleg). */
  inbegrepen: string[]
  /** Wat uitdrukkelijk niet inbegrepen is. */
  niet: string[]
  /** Langere teksten (pagina's, onderdelen, wat de klant aanlevert). */
  blokken: [string, string][]
}

function waardeTekst(v: Veld, w: Waarden): string {
  const x = w[v.key]
  if (v.soort === 'keuzes') {
    const lijst = [...(Array.isArray(x) ? x : []), ...(w[`${v.key}_andere`] ? [String(w[`${v.key}_andere`])] : [])]
    return lijst.join(', ')
  }
  if (v.soort === 'keuze') return [x, w[`${v.key}_andere`]].filter(Boolean).join(': ')
  if (v.soort === 'bedrag') { const s = String(x ?? ''); return s ? `${euro(bedragVan(s))}${v.eenheid ? ` ${v.eenheid}` : ''}` : '' }
  if (v.soort === 'getal') { const s = String(x ?? ''); return s ? `${s}${v.eenheid ? ` ${v.eenheid}` : ''}` : '' }
  if (v.soort === 'datum') { const s = String(x ?? ''); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? datumLang(s) : s }
  return String(x ?? '')
}

/** Eén dienstfiche als blokken voor de pdf; enkel wat ingevuld is. */
export function ficheWeergave(k: DienstFicheKey, w: Waarden): FicheWeergave {
  const f = ficheVan(k)!
  const uit: FicheWeergave = { titel: f.titel, feiten: [], inbegrepen: [], niet: [], blokken: [] }
  for (const v of f.velden) {
    if (v.key === 'niet_inbegrepen') {
      const s = String(w[v.key] ?? '')
      if (s) uit.niet.push(...s.split(/\n|;/).map((x) => x.replace(/^[-•*\s]+/, '').trim()).filter(Boolean))
      continue
    }
    if (v.soort === 'janee') {
      const j = w[v.key]
      if (j !== 'ja' && j !== 'nee') continue
      const detail = j === 'ja' && v.bijJa ? waardeTekst(v.bijJa, w) : ''
      if (v.feit) uit.feiten.push([v.label, `${j === 'ja' ? 'Ja' : 'Nee'}${detail ? ` · ${detail}` : ''}`])
      else if (j === 'ja') uit.inbegrepen.push(detail ? `${v.label}: ${detail}` : v.label)
      else uit.niet.push(v.label)
      continue
    }
    const t = waardeTekst(v, w)
    if (!t) continue
    if (v.soort === 'lang') uit.blokken.push([v.label, t])
    else uit.feiten.push([v.label, t])
  }
  return uit
}

export const ficheHeeftInhoud = (f: FicheWeergave) => f.feiten.length + f.inbegrepen.length + f.niet.length + f.blokken.length > 0

export function datumLang(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })
}

/** "Getekend op 9 november 2026 om 14:32" in Belgische tijd. */
export function getekendOp(iso: string): string {
  const d = new Date(iso)
  const dag = d.toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Brussels' })
  const uur = d.toLocaleTimeString('nl-BE', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Brussels' })
  return `${dag} om ${uur}`
}

// ── Klaar om te bewaren? ────────────────────────────────────────────────────

export type OpmaakFout = { veld: string; fout: string }

/** Wat er minstens moet staan om de offerte te bewaren (concept). */
export function controleerOpmaak(i: OfferteInhoud, extra: { klant: boolean; verantwoordelijke: unknown; vandaag: string }): OpmaakFout[] {
  const f: OpmaakFout[] = []
  if (!extra.klant) f.push({ veld: 'klant', fout: 'Kies de klant.' })
  if (!isVerantwoordelijke(extra.verantwoordelijke)) f.push({ veld: 'verantwoordelijke', fout: 'Wie is verantwoordelijk voor deze offerte?' })
  if (String(i.algemeen.projectnaam ?? '').length < 2) f.push({ veld: 'projectnaam', fout: 'Geef het project een naam.' })
  const g = String(i.algemeen.geldig_tot ?? '')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(g)) f.push({ veld: 'geldig_tot', fout: 'Tot wanneer is de offerte geldig?' })
  else if (g < extra.vandaag) f.push({ veld: 'geldig_tot', fout: 'De geldigheid ligt in het verleden.' })
  const d = String(i.algemeen.datum ?? '')
  if (d && !/^\d{4}-\d{2}-\d{2}$/.test(d)) f.push({ veld: 'datum', fout: 'Kies de datum van de offerte.' })
  const nr = String(i.algemeen.offertenummer ?? '')
  if (nr && !/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,39}$/.test(nr)) f.push({ veld: 'offertenummer', fout: 'Gebruik letters, cijfers en streepjes, bv. OF-2026-001.' })
  if (!i.diensten.length) f.push({ veld: 'diensten', fout: 'Kies minstens één dienst.' })
  for (const k of ['setup', 'maandelijks', 'advertentiebudget', 'verplaatsing', 'huur', 'licenties', 'extern'] as const) {
    if (!isGeldigBedrag(i.prijs[k])) f.push({ veld: `prijs.${k}`, fout: 'Dat bedrag begrijpen we niet. Gebruik bv. 1250 of 1.250,50.' })
  }
  for (const e of i.extra) if (!isGeldigBedrag(e.bedrag)) f.push({ veld: 'extra', fout: `Het bedrag bij "${e.omschrijving || 'extra lijn'}" klopt niet.` })
  return f
}
