// Aanvragen — diensten en consultancy die een klant aanvraagt vanuit het
// portaal. Puur (geen server): portaal, admin, ClickUp-tekst en tests lezen
// dezelfde catalogus en regels.
//
// EEN AANVRAAG IS GEEN OPDRACHT EN GEEN BOEKING. De klant geeft een wens en een
// gewenste timing door; wij beoordelen, bepalen scope, duur, eventuele offerte
// en planning. Dat staat in elke tekst die hieruit vertrekt.

export type AanvraagSoort = 'dienst' | 'consultancy' | 'founders'
export const SOORTEN: AanvraagSoort[] = ['dienst', 'consultancy', 'founders']

// ── Expertises (Personeel → expertprofiel) ───────────────────────────────────
// Vaste lijst, zodat "relevante experts" bij een dienst echt te bepalen is.

export const EXPERTISES = [
  { key: 'marketing', label: 'Marketing' },
  { key: 'foto_video', label: 'Foto- en videografie' },
  { key: 'sales', label: 'Sales optimisation' },
  { key: 'branding', label: 'Branding' },
  { key: 'seo', label: 'SEO' },
  { key: 'meta_ads', label: 'Meta Ads' },
  { key: 'ai', label: 'AI' },
  { key: 'websites', label: 'Websites' },
  { key: 'google_ads', label: 'Google Ads' },
  { key: 'campagnes', label: 'Campagnes' },
  { key: 'performance', label: 'Performance marketing' },
  { key: 'grafisch', label: 'Grafisch ontwerp' },
  { key: 'social', label: 'Sociale media' },
] as const
export type Expertise = (typeof EXPERTISES)[number]['key']
export const expertiseLabel = (k: string): string => EXPERTISES.find((e) => e.key === k)?.label ?? k
export const isExpertise = (k: unknown): k is Expertise => EXPERTISES.some((e) => e.key === k)

// ── Vragen per dienst of consultancy ─────────────────────────────────────────

export type VeldType = 'tekst' | 'lang' | 'keuze' | 'meerkeuze' | 'url'
export type Veld = { key: string; label: string; type: VeldType; opties?: string[]; placeholder?: string; verplicht?: boolean; hulp?: string }
export type Locatie = 'verplicht' | 'optioneel' | 'geen'

export type AanvraagType = {
  key: string
  label: string
  /** Eén zin onder de kaart in het portaal. */
  uitleg: string
  /** Welke expertises passen; leeg = iedereen die als expert zichtbaar is. */
  expertises: Expertise[]
  /** Label en voorbeeld van de hoofdvraag "wat heb je nodig". */
  watLabel: string
  watPlaceholder: string
  velden: Veld[]
  locatie: Locatie
}

const KANALEN = ['Instagram', 'Facebook', 'LinkedIn', 'TikTok', 'YouTube', 'Pinterest']

export const DIENSTEN: AanvraagType[] = [
  {
    key: 'social_media', label: 'Social media management', uitleg: 'Planning, content en beheer van jullie kanalen.',
    expertises: ['social', 'marketing'], watLabel: 'Wat moeten we voor jullie doen?', watPlaceholder: 'Bv. maandelijks 8 posts en 4 reels, inclusief captions en inplannen.',
    velden: [
      { key: 'kanalen', label: 'Kanalen', type: 'meerkeuze', opties: KANALEN },
      { key: 'frequentie', label: 'Hoe vaak posten?', type: 'keuze', opties: ['1–2 keer per week', '3–4 keer per week', 'Dagelijks', 'Weet ik nog niet'] },
      { key: 'doel', label: 'Belangrijkste doel', type: 'keuze', opties: ['Naamsbekendheid', 'Leads', 'Verkoop', 'Rekrutering', 'Community'] },
    ],
    locatie: 'geen',
  },
  {
    key: 'foto_video', label: 'Foto- en videografie', uitleg: 'Reels, bedrijfsvideo’s, aftermovies en fotografie.',
    expertises: ['foto_video'], watLabel: 'Wat willen jullie laten maken?', watPlaceholder: 'Bv. een bedrijfsvideo van 1 minuut voor de website en 3 korte reels.',
    velden: [
      { key: 'soort', label: 'Soort beeldmateriaal', type: 'meerkeuze', opties: ['Reels', 'Bedrijfsvideo', 'Aftermovie', 'Productfoto’s', 'Portretten', 'Eventfotografie'] },
      { key: 'aantal', label: 'Hoeveel video’s of foto’s ongeveer?', type: 'tekst', placeholder: 'Bv. 1 video en 20 foto’s' },
      { key: 'gebruik', label: 'Waar gebruiken jullie het?', type: 'meerkeuze', opties: ['Social media', 'Website', 'Advertenties', 'Intern'] },
    ],
    locatie: 'optioneel',
  },
  {
    key: 'content_shoot', label: 'Content shoot', uitleg: 'Een shootdag voor foto’s en video’s voor jullie kanalen.',
    expertises: ['foto_video', 'social'], watLabel: 'Wat willen jullie in beeld?', watPlaceholder: 'Bv. het team aan het werk, de nieuwe producten en twee korte interviews.',
    velden: [
      { key: 'soort', label: 'Soort content', type: 'meerkeuze', opties: ['Reels', 'Foto’s', 'Interviews', 'Behind the scenes', 'Productbeelden'] },
      { key: 'personen', label: 'Wie staat er in beeld?', type: 'tekst', placeholder: 'Bv. 3 medewerkers en de zaakvoerder' },
    ],
    locatie: 'verplicht',
  },
  {
    key: 'grafisch', label: 'Grafisch ontwerp', uitleg: 'Flyers, brochures, visuals, banners en meer.',
    expertises: ['grafisch'], watLabel: 'Wat moet er ontworpen worden?', watPlaceholder: 'Bv. een flyer A5 recto-verso voor onze opendeurdag.',
    velden: [
      { key: 'wat', label: 'Soort ontwerp', type: 'meerkeuze', opties: ['Flyer', 'Brochure', 'Social media visuals', 'Banner', 'Presentatie', 'Verpakking', 'Andere'] },
      { key: 'formaten', label: 'Formaten', type: 'tekst', placeholder: 'Bv. A5, 1080×1350 px' },
      { key: 'huisstijl', label: 'Is er een huisstijl?', type: 'keuze', opties: ['Ja', 'Deels', 'Nee'] },
    ],
    locatie: 'geen',
  },
  {
    key: 'branding', label: 'Branding en rebranding', uitleg: 'Logo, huisstijl en de manier waarop jullie merk overkomt.',
    expertises: ['branding', 'grafisch'], watLabel: 'Wat willen jullie bereiken met de (re)branding?', watPlaceholder: 'Bv. een frissere uitstraling die beter past bij onze nieuwe klanten.',
    velden: [
      { key: 'soort', label: 'Soort traject', type: 'keuze', opties: ['Nieuwe branding', 'Rebranding', 'Opfrissing'] },
      { key: 'onderdelen', label: 'Wat hoort erbij?', type: 'meerkeuze', opties: ['Logo', 'Huisstijl', 'Brandbook', 'Tone of voice', 'Naam'] },
      { key: 'website', label: 'Huidige website', type: 'url', placeholder: 'https://' },
    ],
    locatie: 'geen',
  },
  {
    key: 'website', label: 'Websiteontwerp en -ontwikkeling', uitleg: 'Een nieuwe website, redesign, webshop of landingspagina.',
    expertises: ['websites'], watLabel: 'Wat moet de website doen?', watPlaceholder: 'Bv. een nieuwe website met onze diensten, cases en een offerteformulier.',
    velden: [
      { key: 'soort', label: 'Soort project', type: 'keuze', opties: ['Nieuwe website', 'Redesign', 'Uitbreiding', 'Webshop', 'Landingspagina'] },
      { key: 'website', label: 'Huidige website', type: 'url', placeholder: 'https://' },
      { key: 'paginas', label: 'Aantal pagina’s', type: 'keuze', opties: ['1–5', '6–15', '16 of meer', 'Weet ik niet'] },
      { key: 'functies', label: 'Functies', type: 'meerkeuze', opties: ['Contactformulier', 'Blog', 'Meertalig', 'Webshop', 'Boekingen', 'Koppelingen met andere tools'] },
    ],
    locatie: 'geen',
  },
  {
    key: 'seo', label: 'SEO', uitleg: 'Beter gevonden worden in Google.',
    expertises: ['seo'], watLabel: 'Waarvoor willen jullie beter gevonden worden?', watPlaceholder: 'Bv. “dakwerken Hasselt” en onze andere diensten in Limburg.',
    velden: [
      { key: 'website', label: 'Website', type: 'url', placeholder: 'https://', verplicht: true },
      { key: 'doelen', label: 'Doelen', type: 'meerkeuze', opties: ['Meer bezoekers', 'Lokaal vindbaar', 'Meer leads', 'Technische controle'] },
      { key: 'regio', label: 'Waar wil je gevonden worden?', type: 'tekst', placeholder: 'Bv. Limburg en Vlaams-Brabant' },
    ],
    locatie: 'geen',
  },
  {
    key: 'sea', label: 'SEA en advertentiebeheer', uitleg: 'Advertenties op Google, Meta, LinkedIn of TikTok.',
    expertises: ['google_ads', 'meta_ads', 'campagnes', 'performance'], watLabel: 'Wat willen jullie met advertenties bereiken?', watPlaceholder: 'Bv. meer offerteaanvragen voor onze renovatiediensten.',
    velden: [
      { key: 'kanalen', label: 'Kanalen', type: 'meerkeuze', opties: ['Google Ads', 'Meta Ads', 'LinkedIn Ads', 'TikTok Ads'] },
      { key: 'doel', label: 'Doel', type: 'keuze', opties: ['Leads', 'Verkoop', 'Naamsbekendheid', 'Websiteverkeer'] },
      { key: 'budget', label: 'Advertentiebudget per maand (indicatief)', type: 'tekst', placeholder: 'Bv. 500 euro' },
    ],
    locatie: 'geen',
  },
  {
    key: 'email', label: 'E-mailmarketing', uitleg: 'Nieuwsbrieven, campagnes en automatische mails.',
    expertises: ['marketing', 'campagnes'], watLabel: 'Wat willen jullie mailen en naar wie?', watPlaceholder: 'Bv. een maandelijkse nieuwsbrief naar onze klanten.',
    velden: [
      { key: 'soort', label: 'Soort', type: 'meerkeuze', opties: ['Nieuwsbrief', 'Automatische flows', 'Campagne', 'Templates'] },
      { key: 'tool', label: 'Welke tool gebruiken jullie?', type: 'tekst', placeholder: 'Bv. Mailchimp, of nog geen' },
      { key: 'lijst', label: 'Hoe groot is jullie lijst ongeveer?', type: 'tekst', placeholder: 'Bv. 1.200 contacten' },
    ],
    locatie: 'geen',
  },
  {
    key: 'ai', label: 'AI-automatisaties', uitleg: 'Repetitief werk automatiseren met AI en slimme koppelingen.',
    expertises: ['ai'], watLabel: 'Welk werk willen jullie automatiseren?', watPlaceholder: 'Bv. offerteaanvragen automatisch verwerken en in ons CRM zetten.',
    velden: [
      { key: 'tools', label: 'Welke tools gebruiken jullie nu?', type: 'tekst', placeholder: 'Bv. Outlook, Teamleader, Excel' },
      { key: 'frequentie', label: 'Hoe vaak komt dit werk voor?', type: 'tekst', placeholder: 'Bv. 30 keer per week' },
    ],
    locatie: 'geen',
  },
  {
    key: 'strategie', label: 'Strategie en marketingadvies', uitleg: 'Een plan en richting voor jullie marketing.',
    expertises: ['marketing', 'performance', 'sales'], watLabel: 'Waar willen jullie hulp bij?', watPlaceholder: 'Bv. een marketingplan voor de lancering van onze nieuwe dienst.',
    velden: [
      { key: 'doel', label: 'Belangrijkste doel', type: 'keuze', opties: ['Groei', 'Nieuwe markt', 'Lancering', 'Herpositionering', 'Andere'] },
    ],
    locatie: 'geen',
  },
  {
    key: 'overige', label: 'Overige', uitleg: 'Iets anders in gedachten? Vertel het ons.',
    expertises: [], watLabel: 'Wat heb je nodig?', watPlaceholder: 'Beschrijf kort wat je zoekt.',
    velden: [], locatie: 'optioneel',
  },
]

export const CONSULTANCY_TARIEF = '€125 per uur'

/** Gemeenschappelijk voor elke consultancy: waar het gesprek of de workshop doorgaat. */
export const CONSULTANCY_VORMEN = ['Online', 'Bij ons op kantoor (jullie bedrijf)', 'Bij NextGenMedia']
export const VORM_MET_ADRES = CONSULTANCY_VORMEN[1]

const consult = (key: string, label: string, uitleg: string, expertises: Expertise[], velden: Veld[] = []): AanvraagType => ({
  key, label, uitleg, expertises, velden, locatie: 'optioneel',
  watLabel: 'Wat is de uitdaging?', watPlaceholder: 'Beschrijf de situatie en waar jullie vastlopen.',
})
const WEBSITE: Veld = { key: 'website', label: 'Website', type: 'url', placeholder: 'https://', verplicht: true }

export const CONSULTANCY: AanvraagType[] = [
  consult('strategie', 'Strategische marketingconsultancy', 'Richting en prioriteiten voor jullie marketing.', ['marketing', 'branding', 'performance']),
  consult('ai_workshop', 'AI-workshop', 'Met jullie team leren werken met AI-tools.', ['ai'], [
    { key: 'deelnemers', label: 'Hoeveel deelnemers?', type: 'tekst', placeholder: 'Bv. 8' },
    { key: 'niveau', label: 'Niveau', type: 'keuze', opties: ['Beginners', 'Gevorderd', 'Gemengd'] },
  ]),
  consult('ai_scan', 'AI- en automatisatiescan', 'Waar kan AI jullie tijd besparen?', ['ai']),
  consult('performance_scan', 'Performance marketing scan', 'Een kritische blik op jullie campagnes en resultaten.', ['performance', 'campagnes', 'google_ads', 'meta_ads']),
  consult('ads_scan', 'Meta Ads- of Google Ads-scan', 'Analyse van jullie advertentieaccount.', ['meta_ads', 'google_ads'], [
    { key: 'platform', label: 'Platform', type: 'meerkeuze', opties: ['Meta Ads', 'Google Ads'] },
  ]),
  consult('workflow_scan', 'Workflow- en efficiëntiescan', 'Waar verliezen jullie tijd in de dagelijkse werking?', ['ai', 'sales']),
  consult('sales_ops_scan', 'Sales operations scan', 'Hoe jullie verkoopproces vandaag loopt en beter kan.', ['sales']),
  consult('leadgen_funnel', 'Leadgeneratie- en salesfunnelanalyse', 'Van eerste contact tot klant: waar haken mensen af?', ['sales', 'performance', 'marketing']),
  consult('crm_advies', 'CRM- en opvolgingsprocesadvies', 'Leads en klanten opvolgen zonder dat er iets tussen valt.', ['sales', 'ai']),
  consult('website_conversie_scan', 'Website- en conversiescan', 'Waarom bezoekers niet (genoeg) contact opnemen.', ['websites', 'seo', 'performance'], [WEBSITE]),
  consult('seo_scan', 'SEO-scan', 'Hoe vindbaar jullie website vandaag is.', ['seo'], [WEBSITE]),
  consult('social_content_strategie', 'Social media- en contentstrategie', 'Welke content, op welk kanaal, voor wie.', ['social', 'marketing', 'foto_video']),
  consult('klantreis_positionering', 'Klantreis- en positioneringsadvies', 'Hoe klanten jullie leren kennen en kiezen.', ['branding', 'marketing']),
  consult('overige', 'Overige consultancy', 'Een ander onderwerp? Leg het ons voor.', []),
]

/** Founders of Flanders: een video over de ondernemer en het verhaal achter het bedrijf. */
export const FOUNDERS: AanvraagType[] = [{
  key: 'founder_video', label: 'Founder video', uitleg: 'Een video over jou als ondernemer en het verhaal achter je bedrijf.',
  expertises: ['foto_video'], watLabel: 'Wat is jouw verhaal?', watPlaceholder: 'Bv. hoe je begon, wat je bedrijf anders maakt en waar je naartoe wil.',
  velden: [{ key: 'wie', label: 'Wie staat er in beeld?', type: 'tekst', placeholder: 'Bv. ik als zaakvoerder en mijn vennoot' }],
  locatie: 'optioneel',
}]

export const catalogus = (soort: AanvraagSoort): AanvraagType[] => (soort === 'dienst' ? DIENSTEN : soort === 'consultancy' ? CONSULTANCY : FOUNDERS)
export const vindType = (soort: AanvraagSoort, key: unknown): AanvraagType | null => catalogus(soort).find((t) => t.key === key) ?? null
export const soortLabel = (s: AanvraagSoort): string => (s === 'dienst' ? 'Dienstenaanvraag' : s === 'consultancy' ? 'Consultancy aanvraag' : 'Founders aanvraag')
export const nieuweAanvraagTitel = (s: AanvraagSoort): string => (s === 'dienst' ? 'Nieuwe dienstenaanvraag' : s === 'consultancy' ? 'Nieuwe consultancy aanvraag' : 'Nieuwe founders aanvraag')
export const isSoort = (v: unknown): v is AanvraagSoort => v === 'dienst' || v === 'consultancy' || v === 'founders'

// ── Timing ───────────────────────────────────────────────────────────────────

export const DAGEN = [
  { key: 'ma', label: 'Ma' }, { key: 'di', label: 'Di' }, { key: 'wo', label: 'Wo' }, { key: 'do', label: 'Do' },
  { key: 'vr', label: 'Vr' }, { key: 'za', label: 'Za' }, { key: 'zo', label: 'Zo' },
] as const
export const TIJDSTIPPEN = [
  { key: 'voormiddag', label: 'Voormiddag' }, { key: 'namiddag', label: 'Namiddag' }, { key: 'avond', label: 'Avond' }, { key: 'flexibel', label: 'Flexibel' },
] as const

// ── Status ───────────────────────────────────────────────────────────────────

export type AanvraagStatus = 'ontvangen' | 'in_behandeling' | 'offerte' | 'aanvaard' | 'ingepland' | 'afgerond' | 'afgewezen' | 'ingetrokken'
/** `team`: wat wij zien. `klant`: wat de klant ziet. Nooit "bevestigd" of "geboekt" vóór wij aanvaarden. */
export const STATUS: Record<AanvraagStatus, { team: string; klant: string; chip: string }> = {
  ontvangen: { team: 'Aanvraag ontvangen', klant: 'Aanvraag ontvangen', chip: 'bg-sky-50 text-sky-800 border-sky-200' },
  in_behandeling: { team: 'In behandeling', klant: 'We bekijken je aanvraag', chip: 'bg-amber-50 text-amber-800 border-amber-200' },
  offerte: { team: 'Offerte verstuurd', klant: 'Offerte klaar voor jou', chip: 'bg-violet-50 text-violet-800 border-violet-200' },
  aanvaard: { team: 'Aanvaard, nog in te plannen', klant: 'Aanvaard, we plannen dit in', chip: 'bg-green-50 text-green-800 border-green-200' },
  ingepland: { team: 'Ingepland', klant: 'Ingepland', chip: 'bg-green-50 text-green-800 border-green-200' },
  afgerond: { team: 'Afgerond', klant: 'Afgerond', chip: 'bg-gray-100 text-gray-700 border-gray-200' },
  afgewezen: { team: 'Afgewezen', klant: 'Niet weerhouden', chip: 'bg-red-50 text-red-700 border-red-200' },
  ingetrokken: { team: 'Ingetrokken door klant', klant: 'Ingetrokken', chip: 'bg-gray-100 text-gray-500 border-gray-200' },
}
export const isStatus = (s: unknown): s is AanvraagStatus => typeof s === 'string' && s in STATUS
/** Statussen die wij met de hand zetten (offerte gaat via de offertestap, ingetrokken via de klant). */
export const TEAM_STATUSSEN: AanvraagStatus[] = ['ontvangen', 'in_behandeling', 'aanvaard', 'ingepland', 'afgerond', 'afgewezen']
export const OPEN_STATUSSEN: AanvraagStatus[] = ['ontvangen', 'in_behandeling', 'offerte', 'aanvaard', 'ingepland']
/** De klant mag intrekken zolang wij nog niets beslisten. */
export const magIntrekken = (s: string): boolean => s === 'ontvangen' || s === 'in_behandeling'

export type Scope = 'binnen' | 'buiten'
export const SCOPE_LABEL: Record<Scope, string> = { binnen: 'Binnen contract', buiten: 'Buiten contract' }

export type OfferteStatus = 'open' | 'aanvaard' | 'geweigerd'
export const OFFERTE_LABEL: Record<OfferteStatus, string> = { open: 'Wacht op klant', aanvaard: 'Aanvaard door klant', geweigerd: 'Geweigerd door klant' }

// ── Validatie van een nieuwe aanvraag ────────────────────────────────────────

export type AanvraagInvoer = {
  soort?: unknown; type?: unknown; wat?: unknown; briefing?: unknown; aandachtspunten?: unknown
  antwoorden?: unknown; periode_van?: unknown; periode_tot?: unknown; voorkeursdagen?: unknown; tijdstippen?: unknown
  locatie?: unknown; deadline?: unknown; expert_id?: unknown
}
export type GeldigeAanvraag = {
  soort: AanvraagSoort; type: string; typeLabel: string; wat: string; briefing: string | null; aandachtspunten: string | null
  antwoorden: Record<string, string | string[]>; periode_van: string | null; periode_tot: string | null
  voorkeursdagen: string[]; tijdstippen: string[]; locatie: string | null; deadline: string | null; expert_id: string | null
}

const isDag = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00Z`))
const tekst = (v: unknown, max: number): string => String(v ?? '').trim().slice(0, max)
const isUrl = (v: string): boolean => { try { const u = new URL(v); return u.protocol === 'https:' || u.protocol === 'http:' } catch { return false } }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Locatie gevraagd? Bij consultancy enkel als de klant "bij ons op kantoor" kiest. */
export function locatieNodig(soort: AanvraagSoort, t: AanvraagType, antwoorden: Record<string, unknown>): Locatie {
  if (soort === 'consultancy') return antwoorden.vorm === VORM_MET_ADRES ? 'verplicht' : 'geen'
  return t.locatie
}

/** Velden die bij dit type horen, met bij consultancy de vorm (online / bij jullie / bij ons). */
export function veldenVan(soort: AanvraagSoort, t: AanvraagType): Veld[] {
  if (soort === 'consultancy') return [
    { key: 'onderwerp', label: 'Onderwerp', type: 'tekst', placeholder: 'Bv. onze Google Ads leveren te weinig aanvragen op', verplicht: true },
    ...t.velden,
    { key: 'vorm', label: 'Waar?', type: 'keuze', opties: CONSULTANCY_VORMEN, verplicht: true },
  ]
  return t.velden
}

export function valideerAanvraag(b: AanvraagInvoer, vandaag: string): { ok: true; waarde: GeldigeAanvraag } | { ok: false; fout: string } {
  const soort: AanvraagSoort | null = isSoort(b.soort) ? b.soort : null
  if (!soort) return { ok: false, fout: 'Onbekend soort aanvraag.' }
  const t = vindType(soort, b.type)
  if (!t) return { ok: false, fout: soort === 'dienst' ? 'Kies een dienst.' : soort === 'consultancy' ? 'Kies een soort consultancy.' : 'Kies wat je wil aanvragen.' }

  const wat = tekst(b.wat, 3000)
  if (wat.length < 5) return { ok: false, fout: `Vul in: ${t.watLabel.toLowerCase()}` }

  // Antwoorden enkel voor velden die bij dit type horen, gecontroleerd tegen hun opties.
  const ruw = (b.antwoorden && typeof b.antwoorden === 'object' ? b.antwoorden : {}) as Record<string, unknown>
  const antwoorden: Record<string, string | string[]> = {}
  for (const v of veldenVan(soort, t)) {
    const x = ruw[v.key]
    if (v.type === 'meerkeuze') {
      const lijst = (Array.isArray(x) ? x : []).filter((o): o is string => typeof o === 'string' && (v.opties ?? []).includes(o))
      if (lijst.length) antwoorden[v.key] = [...new Set(lijst)]
    } else if (v.type === 'keuze') {
      if (typeof x === 'string' && x) {
        if (!(v.opties ?? []).includes(x)) return { ok: false, fout: `Kies een geldige optie bij "${v.label}".` }
        antwoorden[v.key] = x
      }
    } else {
      const s = tekst(x, v.type === 'lang' ? 3000 : 300)
      if (s) {
        if (v.type === 'url' && !isUrl(s.startsWith('http') ? s : `https://${s}`)) return { ok: false, fout: `"${s}" is geen geldig webadres.` }
        antwoorden[v.key] = v.type === 'url' && !s.startsWith('http') ? `https://${s}` : s
      }
    }
    if (v.verplicht && !antwoorden[v.key]) return { ok: false, fout: `Vul in: ${v.label}.` }
  }

  const periode_van = isDag(b.periode_van) ? b.periode_van : null
  const periode_tot = isDag(b.periode_tot) ? b.periode_tot : null
  if ((b.periode_van && !periode_van) || (b.periode_tot && !periode_tot)) return { ok: false, fout: 'Kies een geldige datum.' }
  // De gewenste datum is verplicht (vandaag mag): op die dag komt de ClickUp-taak.
  if (!periode_van) return { ok: false, fout: 'Kies een gewenste datum.' }
  if (periode_van < vandaag) return { ok: false, fout: 'De gewenste datum ligt in het verleden.' }
  if (periode_tot && periode_tot < vandaag) return { ok: false, fout: 'De gewenste periode ligt in het verleden.' }
  if (periode_van && periode_tot && periode_tot < periode_van) return { ok: false, fout: 'Het einde van de periode ligt vóór het begin.' }
  const deadline = isDag(b.deadline) ? b.deadline : null
  if (b.deadline && !deadline) return { ok: false, fout: 'Kies een geldige deadline.' }
  if (deadline && deadline < vandaag) return { ok: false, fout: 'De deadline ligt in het verleden.' }

  const dagKeys = DAGEN.map((d) => d.key as string), tijdKeys = TIJDSTIPPEN.map((d) => d.key as string)
  const voorkeursdagen = [...new Set((Array.isArray(b.voorkeursdagen) ? b.voorkeursdagen : []).filter((d): d is string => typeof d === 'string' && dagKeys.includes(d)))]
    .sort((a, c) => dagKeys.indexOf(a) - dagKeys.indexOf(c))
  const tijdstippen = [...new Set((Array.isArray(b.tijdstippen) ? b.tijdstippen : []).filter((d): d is string => typeof d === 'string' && tijdKeys.includes(d)))]

  const nodig = locatieNodig(soort, t, antwoorden)
  const locatie = nodig === 'geen' ? null : tekst(b.locatie, 300) || null
  if (nodig === 'verplicht' && (!locatie || locatie.length < 3)) return { ok: false, fout: soort === 'consultancy' ? 'Vul het adres in waar het gesprek doorgaat.' : 'Vul de locatie in.' }

  const expert_id = typeof b.expert_id === 'string' && UUID.test(b.expert_id) ? b.expert_id : null
  if (b.expert_id && !expert_id) return { ok: false, fout: 'Ongeldige expert.' }

  return {
    ok: true,
    waarde: {
      soort, type: t.key, typeLabel: t.label, wat, briefing: tekst(b.briefing, 5000) || null, aandachtspunten: tekst(b.aandachtspunten, 3000) || null,
      antwoorden, periode_van, periode_tot, voorkeursdagen, tijdstippen, locatie, deadline, expert_id,
    },
  }
}

// ── Experts ──────────────────────────────────────────────────────────────────

export type ExpertBron = { id: string; voornaam: string; achternaam: string | null; actief: boolean; expert_zichtbaar: boolean | null; expertises: string[] | null }

/**
 * Wie de klant mag kiezen: actief en als expert zichtbaar. Standaard enkel wie
 * een passende expertise heeft; met `iedereen` (diensten, instelbaar in
 * Instellingen → Team in de klantapp) iedereen, met de specialisten eerst.
 */
export function relevanteExperts<T extends ExpertBron>(lijst: T[], t: AanvraagType, opties: { iedereen?: boolean } = {}): (T & { relevant: Expertise[] })[] {
  return lijst
    .filter((p) => p.actief && p.expert_zichtbaar === true)
    .map((p) => {
      const eigen = (p.expertises ?? []).filter(isExpertise)
      return { ...p, relevant: t.expertises.length ? eigen.filter((e) => t.expertises.includes(e)) : eigen }
    })
    .filter((p) => opties.iedereen || !t.expertises.length || p.relevant.length > 0)
    .sort((a, b) => b.relevant.length - a.relevant.length || a.voornaam.localeCompare(b.voornaam, 'nl'))
}

/** Instelling (app_settings 'team_klantapp'): bij diensten iedereen tonen of enkel specialisten. */
export type TeamKlantappInstelling = { diensten_iedereen: boolean }
export const TEAM_KLANTAPP_SLEUTEL = 'team_klantapp'
export const teamKlantappUit = (v: unknown): TeamKlantappInstelling => ({ diensten_iedereen: (v as { diensten_iedereen?: unknown } | null)?.diensten_iedereen !== false })
/** Iedereen tonen? Enkel bij diensten (en founders); consultancy blijft op expertise. */
export const toonIedereen = (soort: AanvraagSoort, inst: TeamKlantappInstelling): boolean => soort !== 'consultancy' && inst.diensten_iedereen

export const volleNaam = (p: { voornaam: string; achternaam: string | null }): string => [p.voornaam, p.achternaam].filter(Boolean).join(' ')

// ── Weergave van timing en antwoorden (admin, portaal, ClickUp) ──────────────

const datum = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('nl-BE', { day: 'numeric', month: 'long', year: 'numeric' })

export function timingTekst(a: { periode_van: string | null; periode_tot: string | null; voorkeursdagen: string[] | null; tijdstippen: string[] | null; deadline: string | null }): string[] {
  const r: string[] = []
  if (a.periode_van && a.periode_tot) r.push(`Gewenste periode: ${datum(a.periode_van)} tot ${datum(a.periode_tot)}`)
  else if (a.periode_van) r.push(`Gewenste datum: ${datum(a.periode_van)}`)
  else if (a.periode_tot) r.push(`Gewenste periode: vanaf nu tot ${datum(a.periode_tot)}`)
  if (a.voorkeursdagen?.length) r.push(`Voorkeursdagen: ${a.voorkeursdagen.map((d) => DAGEN.find((x) => x.key === d)?.label ?? d).join(', ')}`)
  if (a.tijdstippen?.length) r.push(`Tijdstippen: ${a.tijdstippen.map((d) => TIJDSTIPPEN.find((x) => x.key === d)?.label ?? d).join(', ')}`)
  if (a.deadline) r.push(`Gewenste deadline: ${datum(a.deadline)}`)
  return r
}

export function antwoordRegels(soort: AanvraagSoort, typeKey: string, antwoorden: Record<string, unknown> | null): { label: string; waarde: string }[] {
  const t = vindType(soort, typeKey)
  if (!t || !antwoorden) return []
  return veldenVan(soort, t)
    .filter((v) => antwoorden[v.key] !== undefined && antwoorden[v.key] !== '' && !(Array.isArray(antwoorden[v.key]) && !(antwoorden[v.key] as unknown[]).length))
    .map((v) => ({ label: v.label, waarde: Array.isArray(antwoorden[v.key]) ? (antwoorden[v.key] as string[]).join(', ') : String(antwoorden[v.key]) }))
}

// ── ClickUp ──────────────────────────────────────────────────────────────────

/** Altijd herkenbaar als aanvraag, nooit als opdracht of boeking. */
export function clickupNaam(soort: AanvraagSoort, klant: string, typeLabel: string): string {
  return `${soortLabel(soort)} – ${klant} – ${typeLabel}`
}

export function clickupOmschrijving(a: {
  id: string; soort: AanvraagSoort; type: string; type_label: string; klant: string; wat: string; briefing: string | null; aandachtspunten: string | null
  antwoorden: Record<string, unknown> | null; periode_van: string | null; periode_tot: string | null; voorkeursdagen: string[] | null; tijdstippen: string[] | null
  locatie: string | null; deadline: string | null; expert_naam: string | null; ingediend_door: string | null; bestanden: string[]
}, adminLink: string): string {
  const t = vindType(a.soort, a.type)
  return [
    `AANVRAAG – nog geen bevestigde opdracht of boeking. Wij beoordelen scope, duur, eventuele offerte en planning.`,
    a.soort === 'consultancy' ? `Tarief consultancy: ${CONSULTANCY_TARIEF}. Duur en eventuele offerte bepalen wij.` : null,
    ``,
    `Klant: ${a.klant}`,
    `${a.soort === 'dienst' ? 'Dienst' : 'Consultancy'}: ${a.type_label}`,
    a.ingediend_door ? `Ingediend door: ${a.ingediend_door}` : null,
    `Expertvoorkeur: ${a.expert_naam ?? 'Geen voorkeur – stel zelf een expert voor'} (voorkeur, nog niet bevestigd)`,
    ``,
    `${t?.watLabel ?? 'Wat'}:`,
    a.wat,
    ...antwoordRegels(a.soort, a.type, a.antwoorden).map((r) => `${r.label}: ${r.waarde}`),
    a.briefing ? `\nBriefing:\n${a.briefing}` : null,
    a.aandachtspunten ? `\nAandachtspunten:\n${a.aandachtspunten}` : null,
    ``,
    ...timingTekst(a),
    a.locatie ? `Locatie: ${a.locatie}` : null,
    a.bestanden.length ? `\nBestanden (te bekijken in de app): ${a.bestanden.join(', ')}` : null,
    ``,
    `Aanvraag in de app: ${adminLink}`,
    `Ref: ngm-aanvraag:${a.id}`,
  ].filter((x) => x !== null).join('\n')
}
