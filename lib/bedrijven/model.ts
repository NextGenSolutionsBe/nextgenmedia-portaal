// Bedrijf en dienstencatalogus (verbeterplan fase 1, 26 nov 2026).
// Pure regels: veilig in server- en clientcomponenten.
//
// NextGen Agency BV werkt met twee handelsnamen die als aparte bedrijven
// werken: NextGen Media (marketing) en NextGen Solutions (automatisatie).
// "Algemeen" is voor wat bij geen van beide hoort (aankopen, kantoor).
// De catalogus en de bedrijven staan in de databank (Instellingen → Diensten);
// de standaardlijsten hieronder zijn enkel een terugval als die niet leesbaar is.

export type BedrijfRij = {
  slug: string
  naam: string
  handelsnaam: string | null
  kort: string | null
  kleur: string | null
  volgorde: number
  actief: boolean
  /** Merkgegevens (fase 2): website, contactadres, antwoordadres voor mails, voettekst op documenten. */
  website?: string | null
  email?: string | null
  antwoord_email?: string | null
  voettekst?: string | null
}

export type Eenheid = 'eenmalig' | 'maand' | 'uur'

export type DienstRij = {
  slug: string
  naam: string
  bedrijf: string
  parent_slug: string | null
  omschrijving: string | null
  inbegrepen: string[]
  niet_inbegrepen: string[]
  eenheid: Eenheid
  terugkerend: boolean
  actief: boolean
  volgorde: number
  kleur: string | null
  min_prijs: number | null
  min_marge_pct: number | null
}

export type Catalogus = { bedrijven: BedrijfRij[]; diensten: DienstRij[] }

export const MEDIA = 'nextgenmedia'
export const SOLUTIONS = 'nextgensolutions'
export const ALGEMEEN = 'algemeen'

export const STANDAARD_BEDRIJVEN: BedrijfRij[] = [
  { slug: MEDIA, naam: 'NextGen Media', handelsnaam: 'NextGenMedia', kort: 'Media', kleur: '#0F0F0F', volgorde: 1, actief: true },
  { slug: SOLUTIONS, naam: 'NextGen Solutions', handelsnaam: 'NextGenSolutions', kort: 'Solutions', kleur: '#3B82F6', volgorde: 2, actief: true },
  { slug: ALGEMEEN, naam: 'Algemeen', handelsnaam: 'NextGen Agency BV', kort: 'Algemeen', kleur: '#6B7280', volgorde: 3, actief: true },
]

const d = (slug: string, naam: string, bedrijf: string, volgorde: number, eenheid: Eenheid, terugkerend: boolean, kleur: string, parent: string | null = null, omschrijving: string | null = null): DienstRij => ({
  slug, naam, bedrijf, parent_slug: parent, omschrijving, inbegrepen: [], niet_inbegrepen: [], eenheid, terugkerend, actief: true, volgorde, kleur, min_prijs: null, min_marge_pct: null,
})

export const STANDAARD_DIENSTEN: DienstRij[] = [
  d('branding', 'Branding', MEDIA, 10, 'eenmalig', false, '#FDE0DE'),
  d('grafisch_ontwerp', 'Grafisch ontwerp', MEDIA, 11, 'eenmalig', false, '#FDE0DE', 'branding'),
  d('social_media', 'Social media', MEDIA, 20, 'maand', true, '#FFF5C2'),
  d('marketingstrategie', 'Marketingstrategie & consultancy', MEDIA, 30, 'uur', false, '#F0E4D6'),
  d('emailmarketing', 'E-mailmarketing', MEDIA, 31, 'eenmalig', false, '#F0E4D6', 'marketingstrategie'),
  d('websites', 'Websites', MEDIA, 40, 'eenmalig', false, '#ECE2FB'),
  d('seo', 'SEO', MEDIA, 41, 'maand', true, '#ECE2FB', 'websites'),
  d('website_onderhoud', 'Website-onderhoud', MEDIA, 42, 'maand', true, '#ECE2FB', 'websites'),
  d('ads', 'Google & Meta Ads', MEDIA, 50, 'maand', true, '#D6F4EF'),
  d('foto_video', 'Foto & video', MEDIA, 60, 'eenmalig', false, '#DCF3E2'),
  d('ai_automatisatie', 'AI-automatisatie', SOLUTIONS, 110, 'eenmalig', false, '#DDEBFC'),
  d('software_op_maat', 'Software op maat', SOLUTIONS, 120, 'eenmalig', false, '#E3E8FD'),
  d('care', 'Care', SOLUTIONS, 130, 'maand', true, '#E6F0FB'),
]

export const STANDAARD_CATALOGUS: Catalogus = { bedrijven: STANDAARD_BEDRIJVEN, diensten: STANDAARD_DIENSTEN }

export const EENHEDEN: { key: Eenheid; label: string }[] = [
  { key: 'eenmalig', label: 'Eenmalig' },
  { key: 'maand', label: 'Per maand' },
  { key: 'uur', label: 'Per uur' },
]

// ── Opzoeken ────────────────────────────────────────────────────────────────

export const vindBedrijf = (c: Catalogus, slug: string | null | undefined): BedrijfRij | null =>
  (slug ? c.bedrijven.find((b) => b.slug === slug) : null) ?? null

export const vindDienst = (c: Catalogus, slug: string | null | undefined): DienstRij | null =>
  (slug ? c.diensten.find((x) => x.slug === slug) : null) ?? null

/** "Media", "Solutions", "Algemeen"; onbekend = leeg. */
export function bedrijfKort(c: Catalogus, slug: string | null | undefined): string {
  const b = vindBedrijf(c, slug)
  return b ? (b.kort || b.naam) : ''
}

export function bedrijfVanDienst(c: Catalogus, slug: string | null | undefined): string | null {
  return vindDienst(c, slug)?.bedrijf ?? null
}

/** De hoofddienst (voor rapporten): een subdienst telt bij zijn hoofddienst. */
export function hoofdDienst(c: Catalogus, slug: string | null | undefined): DienstRij | null {
  const x = vindDienst(c, slug)
  if (!x) return null
  return x.parent_slug ? (vindDienst(c, x.parent_slug) ?? x) : x
}

/** Diensten in de juiste volgorde, optioneel enkel van één bedrijf en enkel actieve. */
export function dienstenLijst(c: Catalogus, opties: { bedrijf?: string | null; ookInactief?: boolean } = {}): DienstRij[] {
  return c.diensten
    .filter((x) => (opties.ookInactief || x.actief) && (!opties.bedrijf || x.bedrijf === opties.bedrijf))
    .sort((a, b) => a.volgorde - b.volgorde || a.naam.localeCompare(b.naam))
}

/** De catalogus als boom: hoofddiensten met hun subdiensten, per bedrijf. */
export function boom(c: Catalogus, ookInactief = false): { bedrijf: BedrijfRij; diensten: { dienst: DienstRij; sub: DienstRij[] }[] }[] {
  const lijst = dienstenLijst(c, { ookInactief })
  return [...c.bedrijven]
    .sort((a, b) => a.volgorde - b.volgorde)
    .map((bedrijf) => ({
      bedrijf,
      diensten: lijst
        .filter((x) => x.bedrijf === bedrijf.slug && !x.parent_slug)
        .map((dienst) => ({ dienst, sub: lijst.filter((x) => x.parent_slug === dienst.slug) })),
    }))
    .filter((g) => g.diensten.length > 0 || g.bedrijf.slug !== ALGEMEEN)
}

// ── Merkgegevens per bedrijf (fase 2) ───────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export type BedrijfInvoer = { naam?: unknown; handelsnaam?: unknown; kort?: unknown; kleur?: unknown; website?: unknown; email?: unknown; antwoord_email?: unknown; voettekst?: unknown }

/** Merkgegevens nakijken. De slug verandert nooit; enkel wat op documenten en mails komt. */
export function controleerBedrijf(invoer: BedrijfInvoer): { ok: true; waarde: Omit<BedrijfRij, 'slug' | 'volgorde' | 'actief'> } | { ok: false; fout: string } {
  const t = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
  const naam = t(invoer.naam, 80)
  if (naam.length < 2) return { ok: false, fout: 'Geef het bedrijf een naam.' }
  const email = t(invoer.email, 160).toLowerCase()
  const antwoord = t(invoer.antwoord_email, 160).toLowerCase()
  if (email && !EMAIL_RE.test(email)) return { ok: false, fout: 'Het e-mailadres klopt niet.' }
  if (antwoord && !EMAIL_RE.test(antwoord)) return { ok: false, fout: 'Het antwoordadres klopt niet.' }
  const kleur = typeof invoer.kleur === 'string' && /^#[0-9a-fA-F]{6}$/.test(invoer.kleur) ? invoer.kleur : null
  const website = t(invoer.website, 120).replace(/^https?:\/\//, '').replace(/\/$/, '')
  return {
    ok: true,
    waarde: {
      naam, handelsnaam: t(invoer.handelsnaam, 80) || null, kort: t(invoer.kort, 30) || null, kleur,
      website: website || null, email: email || null, antwoord_email: antwoord || null,
      voettekst: String(invoer.voettekst ?? '').trim().slice(0, 500) || null,
    },
  }
}

// ── Catalogus beheren ───────────────────────────────────────────────────────

export function slugVan(naam: string): string {
  return naam.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' en ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

const tekstLijst = (v: unknown): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split('\n') : [])
    .map((x) => String(x ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 30)
    .map((x) => x.slice(0, 200))

const getalOfNull = (v: unknown, min: number, max: number): number | null | 'fout' => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'))
  if (!Number.isFinite(n) || n < min || n > max) return 'fout'
  return Math.round(n * 100) / 100
}

export type DienstInvoer = Partial<Omit<DienstRij, 'inbegrepen' | 'niet_inbegrepen' | 'min_prijs' | 'min_marge_pct'>> & { inbegrepen?: unknown; niet_inbegrepen?: unknown; min_prijs?: unknown; min_marge_pct?: unknown }

/**
 * Een dienst nakijken voor hij bewaard wordt. `bestaand` = de slug die je
 * aanpast (leeg bij een nieuwe dienst). Een subdienst hangt onder een
 * hoofddienst van hetzelfde bedrijf, één niveau diep.
 */
export function controleerDienst(invoer: DienstInvoer, c: Catalogus, bestaand?: string | null):
  { ok: true; waarde: DienstRij } | { ok: false; fout: string } {
  const naam = String(invoer.naam ?? '').replace(/\s+/g, ' ').trim()
  if (naam.length < 2) return { ok: false, fout: 'Geef de dienst een naam.' }
  if (naam.length > 80) return { ok: false, fout: 'De naam is te lang (max. 80 tekens).' }
  const bedrijf = String(invoer.bedrijf ?? '')
  if (!vindBedrijf(c, bedrijf)) return { ok: false, fout: 'Kies het bedrijf van de dienst.' }
  const eenheid = (invoer.eenheid ?? 'eenmalig') as Eenheid
  if (!EENHEDEN.some((e) => e.key === eenheid)) return { ok: false, fout: 'Kies eenmalig, per maand of per uur.' }

  const slug = bestaand || slugVan(naam)
  if (!slug) return { ok: false, fout: 'Geef de dienst een naam met letters.' }
  if (!bestaand && vindDienst(c, slug)) return { ok: false, fout: 'Er bestaat al een dienst met die naam.' }

  const parent = invoer.parent_slug ? String(invoer.parent_slug) : null
  if (parent) {
    const p = vindDienst(c, parent)
    if (!p) return { ok: false, fout: 'De hoofddienst bestaat niet.' }
    if (p.parent_slug) return { ok: false, fout: 'Een subdienst kan niet onder een andere subdienst.' }
    if (p.bedrijf !== bedrijf) return { ok: false, fout: 'Een subdienst hoort bij hetzelfde bedrijf als zijn hoofddienst.' }
    if (parent === slug) return { ok: false, fout: 'Een dienst kan niet onder zichzelf.' }
    if (bestaand && c.diensten.some((x) => x.parent_slug === bestaand)) return { ok: false, fout: 'Deze dienst heeft zelf subdiensten en kan dus geen subdienst worden.' }
  }

  const minPrijs = getalOfNull(invoer.min_prijs, 0, 10_000_000)
  if (minPrijs === 'fout') return { ok: false, fout: 'De minimumprijs is geen geldig bedrag.' }
  const minMarge = getalOfNull(invoer.min_marge_pct, 0, 100)
  if (minMarge === 'fout') return { ok: false, fout: 'De minimale marge ligt tussen 0 en 100%.' }
  const volgorde = Number.isFinite(Number(invoer.volgorde)) ? Math.round(Number(invoer.volgorde)) : 999
  const kleur = typeof invoer.kleur === 'string' && /^#[0-9a-fA-F]{6}$/.test(invoer.kleur) ? invoer.kleur : null

  return {
    ok: true,
    waarde: {
      slug, naam, bedrijf, parent_slug: parent,
      omschrijving: String(invoer.omschrijving ?? '').trim().slice(0, 500) || null,
      inbegrepen: tekstLijst(invoer.inbegrepen),
      niet_inbegrepen: tekstLijst(invoer.niet_inbegrepen),
      eenheid,
      terugkerend: invoer.terugkerend === undefined ? eenheid === 'maand' : Boolean(invoer.terugkerend),
      actief: invoer.actief === undefined ? true : Boolean(invoer.actief),
      volgorde, kleur, min_prijs: minPrijs, min_marge_pct: minMarge,
    },
  }
}

// ── Oude waarden (zelfde regels als dienst_mapping in de databank) ───────────

/** De dienst van een oude service_slug (contracten, facturen, klantdiensten). */
export const SERVICE_SLUG_NAAR_DIENST: Record<string, string> = {
  'social-media': 'social_media',
  webdesign: 'websites',
  'foto-video': 'foto_video',
  'grafisch-ontwerp': 'grafisch_ontwerp',
  'marketing-consultancy': 'marketingstrategie',
  ads: 'ads',
}

/** Zekere mapping van de diensten op een projectkaart (de rest gaat naar Te classificeren). */
export const OPDRACHT_DIENST_NAAR_CATALOGUS: Record<string, string> = {
  social_media: 'social_media',
  webdesign: 'websites',
  foto_video: 'foto_video',
  grafisch: 'grafisch_ontwerp',
  branding: 'grafisch_ontwerp',
  advertising: 'ads',
  meta_ads: 'ads',
  google_ads: 'ads',
  'E-mailmarketing': 'emailmarketing',
}

/** De omgekeerde weg: welke oude sleutel op de projectkaart past bij een catalogusdienst (voor bestaande schermen). */
export function opdrachtSleutelVoor(dienst: string): string | null {
  const c = hoofdOf(dienst)
  if (c === 'ai_automatisatie' || c === 'software_op_maat' || c === 'care') return 'ngs'
  if (c === 'marketingstrategie') return 'consultancy'
  const paar = Object.entries(OPDRACHT_DIENST_NAAR_CATALOGUS).find(([, v]) => v === dienst || v === c)
  return paar?.[0] ?? null
}
function hoofdOf(slug: string): string {
  const x = STANDAARD_DIENSTEN.find((y) => y.slug === slug)
  return x?.parent_slug ?? slug
}

// ── Aanvragen in de klantapp per bedrijf (fase 2, K87) ──────────────────────

/** Bij welk bedrijf hoort een soort aanvraag (zelfde indeling als dienst_mapping). Onbekend = "Iets anders". */
const AANVRAAG_SOLUTIONS = new Set(['dienst:ai', 'consultancy:ai_workshop', 'consultancy:ai_scan', 'consultancy:workflow_scan', 'consultancy:sales_ops_scan', 'consultancy:crm_advies'])
const AANVRAAG_ANDERS = new Set(['dienst:overige', 'consultancy:overige'])

export function aanvraagBedrijf(soort: string, type: string): typeof MEDIA | typeof SOLUTIONS | null {
  const k = `${soort}:${type}`
  if (AANVRAAG_SOLUTIONS.has(k)) return SOLUTIONS
  if (AANVRAAG_ANDERS.has(k)) return null
  return MEDIA
}

/** Groepen voor de klantapp: eerst marketing (Media), dan bedrijfsprocessen (Solutions), dan iets anders. */
export function aanvraagGroepen<T extends { key: string }>(soort: string, lijst: T[]): { sleutel: string; titel: string; items: T[] }[] {
  const titel = soort === 'consultancy'
    ? { media: 'Marketing', solutions: 'Bedrijfsprocessen en automatisatie', anders: 'Iets anders' }
    : { media: 'Marketing en content · NextGen Media', solutions: 'Automatisatie en software · NextGen Solutions', anders: 'Iets anders' }
  const groepen = [
    { sleutel: 'media', titel: titel.media, items: lijst.filter((x) => aanvraagBedrijf(soort, x.key) === MEDIA) },
    { sleutel: 'solutions', titel: titel.solutions, items: lijst.filter((x) => aanvraagBedrijf(soort, x.key) === SOLUTIONS) },
    { sleutel: 'anders', titel: titel.anders, items: lijst.filter((x) => aanvraagBedrijf(soort, x.key) === null) },
  ]
  return groepen.filter((g) => g.items.length > 0)
}

// ── Te classificeren ────────────────────────────────────────────────────────

export type KlassificatieVeld = 'bedrijf' | 'dienst'

export type KlassificatieRij = {
  id: string
  tabel: string
  rij_id: string
  veld: KlassificatieVeld
  voorstel: string | null
  reden: string | null
  aangemaakt_op: string
  /** Wat er op het scherm staat: titel, klant, datum, link. */
  titel: string
  klant: string | null
  datum: string | null
  link: string | null
}

export const KLASSIFICATIE_TABELLEN: Record<string, { label: string; meervoud: string; link: (id: string) => string | null; metDienst: boolean }> = {
  opdrachten: { label: 'Projectkaart', meervoud: 'Projectkaarten', link: (id) => `/admin/opdrachten?opdracht=${id}`, metDienst: true },
  contracts: { label: 'Contract', meervoud: 'Contracten', link: (id) => `/admin/contracts/${id}`, metDienst: true },
  invoices: { label: 'Factuur', meervoud: 'Facturen', link: (id) => `/admin/invoices?factuur=${id}`, metDienst: true },
  recurring_invoices: { label: 'Maandreeks', meervoud: 'Maandreeksen', link: () => '/admin/invoices', metDienst: true },
  klant_meetings: { label: 'Meeting', meervoud: 'Meetings', link: () => '/admin/meetings', metDienst: false },
  purchases: { label: 'Aankoop', meervoud: 'Aankopen', link: () => '/admin/purchases', metDienst: false },
  cost_entries: { label: 'Kost', meervoud: 'Kosten', link: () => '/admin/revenue/kosten', metDienst: false },
  klant_aanvragen: { label: 'Aanvraag', meervoud: 'Aanvragen', link: (id) => `/admin/aanvragen?aanvraag=${id}`, metDienst: true },
  opleveringen: { label: 'Oplevering', meervoud: 'Opleveringen', link: (id) => `/admin/opleveringen?oplevering=${id}`, metDienst: true },
}

export const isKlassificatieTabel = (t: unknown): t is string => typeof t === 'string' && t in KLASSIFICATIE_TABELLEN

/** Mag deze keuze voor dit veld? Bedrijf = een gekend bedrijf; dienst = een gekende, actieve dienst. */
export function controleerKeuze(c: Catalogus, veld: KlassificatieVeld, keuze: unknown): string | null {
  const k = typeof keuze === 'string' ? keuze : ''
  if (veld === 'bedrijf') return vindBedrijf(c, k) ? null : 'Kies Media, Solutions of Algemeen.'
  const x = vindDienst(c, k)
  if (!x) return 'Kies een dienst uit de catalogus.'
  return null
}

// ── Bedrijfsschakelaar (Alles, Media, Solutions) ─────────────────────────────

export type BedrijfFilter = 'alles' | typeof MEDIA | typeof SOLUTIONS
export const BEDRIJF_FILTERS: { key: BedrijfFilter; label: string }[] = [
  { key: 'alles', label: 'Alles' },
  { key: MEDIA, label: 'Media' },
  { key: SOLUTIONS, label: 'Solutions' },
]
export const isBedrijfFilter = (v: unknown): v is BedrijfFilter => v === 'alles' || v === MEDIA || v === SOLUTIONS
export const BEDRIJF_COOKIE = 'ngm-bedrijf'

/**
 * Hoort iets met dit bedrijf in de gekozen weergave? "Algemeen" en nog niet
 * geclassificeerd (leeg) staan in beide, zodat er nooit iets stil verdwijnt.
 */
export function pastBijFilter(filter: BedrijfFilter | null | undefined, bedrijf: string | null | undefined): boolean {
  if (!filter || filter === 'alles') return true
  if (!bedrijf || bedrijf === ALGEMEEN) return true
  return bedrijf === filter
}

/** Bij welke bedrijven is een klant klant? Uit de bedrijven van zijn projecten, contracten en facturen. */
export function klantBedrijven(bedrijven: (string | null | undefined)[]): (typeof MEDIA | typeof SOLUTIONS)[] {
  const s = new Set(bedrijven.filter((b): b is string => b === MEDIA || b === SOLUTIONS))
  return [MEDIA, SOLUTIONS].filter((b) => s.has(b)) as (typeof MEDIA | typeof SOLUTIONS)[]
}

export function klantBedrijfLabel(lijst: string[]): string {
  if (lijst.includes(MEDIA) && lijst.includes(SOLUTIONS)) return 'Beide'
  if (lijst.includes(SOLUTIONS)) return 'Solutions'
  if (lijst.includes(MEDIA)) return 'Media'
  return ''
}
