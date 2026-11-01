// Opdrachten als kanbanbord — pure module, ook bruikbaar in clientcomponenten.
//
// Eén kaart per project, ook meerdere per klant (een vaste klant die een
// camionette laat bestickeren krijgt gewoon een nieuwe kaart). De kolom volgt
// uit de bestaande status van de opdracht: zo blijven pipeline, verslag en
// statistieken op dezelfde gegevens draaien. Slepen zet de status die bij de
// kolom hoort; binnen een kolom blijft de fijnere stap (bv. "Wacht op klant")
// bewaard.
//
// Automatisch schuift een kaart enkel naar Contract (gekoppeld contract
// verstuurd), Getekend contract (ondertekend) en Afgerond (de volledige
// contractwaarde gefactureerd, voorschotten en maandfacturen samen). In
// uitvoering zetten gebeurt altijd met de hand.

import { statusInfo, type OpdrachtStatus, type Koppelingen, type FactuurKoppeling } from '@/lib/opdrachten'

export type KolomKey = 'potentieel' | 'offerte' | 'contract' | 'getekend' | 'uitvoering' | 'afgerond' | 'stopgezet'

export type Kolom = {
  key: KolomKey
  label: string
  /** Korte uitleg onder de kolomkop. */
  uitleg: string
  /** De statussen die in deze kolom vallen, in volgorde. */
  stappen: OpdrachtStatus[]
  /** Status die een kaart krijgt als je ze naar deze kolom sleept. */
  standaard: OpdrachtStatus
  /** Faselabel bovenaan de kaart en in de kolomkop (Tailwind, staat letterlijk hier voor de build). */
  label_kleur: string
  /** Dunne balk bovenaan de kolom. */
  balk: string
}

export const KOLOMMEN: Kolom[] = [
  { key: 'potentieel', label: 'Potentiële opdracht', uitleg: 'Er is interesse. Nog geen prijs gedeeld.',
    stappen: ['open', 'voorstel_gevraagd', 'voorstel_bezig'], standaard: 'open',
    label_kleur: 'bg-slate-700 text-white', balk: 'bg-slate-500' },
  { key: 'offerte', label: 'Offerte gestuurd', uitleg: 'Prijs of projectvoorstel gedeeld. We wachten op een antwoord.',
    stappen: ['voorstel_klaar', 'voorstel_voorgelegd', 'interesse'], standaard: 'voorstel_voorgelegd',
    label_kleur: 'bg-violet-600 text-white', balk: 'bg-violet-500' },
  { key: 'contract', label: 'Contract', uitleg: 'Contract verstuurd, nog niet getekend.',
    stappen: ['contract_verstuurd'], standaard: 'contract_verstuurd',
    label_kleur: 'bg-blue-600 text-white', balk: 'bg-blue-500' },
  { key: 'getekend', label: 'Getekend contract', uitleg: 'Getekend in de app of door ons op getekend gezet.',
    stappen: ['getekend'], standaard: 'getekend',
    label_kleur: 'bg-teal-700 text-white', balk: 'bg-teal-600' },
  { key: 'uitvoering', label: 'In uitvoering', uitleg: 'Het project loopt. Hier zet je het zelf.',
    stappen: ['bezig', 'wacht', 'opgeleverd', 'te_factureren', 'factuur_verstuurd'], standaard: 'bezig',
    label_kleur: 'bg-orange-500 text-white', balk: 'bg-orange-400' },
  { key: 'afgerond', label: 'Afgerond', uitleg: 'De volledige contractwaarde is gefactureerd.',
    stappen: ['afgerond', 'betaald'], standaard: 'afgerond',
    label_kleur: 'bg-green-600 text-white', balk: 'bg-green-500' },
  { key: 'stopgezet', label: 'Stopgezet of geen akkoord', uitleg: 'Gaat niet door of vroegtijdig gestopt.',
    stappen: ['geen_interesse', 'geannuleerd'], standaard: 'geen_interesse',
    label_kleur: 'bg-red-600 text-white', balk: 'bg-red-500' },
]

export const kolomInfo = (key: KolomKey): Kolom => KOLOMMEN.find((k) => k.key === key) ?? KOLOMMEN[0]
export const isKolom = (v: unknown): v is KolomKey => KOLOMMEN.some((k) => k.key === v)

/** In welke kolom staat een opdracht met deze status? */
export function kolomVan(status: string | null | undefined): KolomKey {
  return KOLOMMEN.find((k) => (k.stappen as string[]).includes(String(status)))?.key ?? 'potentieel'
}

/** Positie van een kolom op het bord (stopgezet telt als zijspoor, achteraan). */
export const kolomRang = (key: KolomKey): number => KOLOMMEN.findIndex((k) => k.key === key)

/** Namen van de stappen zoals ze op het bord heten (een paar lezen anders dan in de lijst). */
const STAP_LABEL: Partial<Record<OpdrachtStatus, string>> = {
  open: 'Nieuw',
  voorstel_klaar: 'Projectvoorstel klaar',
  voorstel_voorgelegd: 'Offerte gedeeld',
  interesse: 'Klant wil verder',
  geen_interesse: 'Geen akkoord',
  geannuleerd: 'Vroegtijdig stopgezet',
}
export const stapLabel = (s: OpdrachtStatus | string): string => STAP_LABEL[s as OpdrachtStatus] ?? statusInfo(s).label

/**
 * Welke status krijgt een kaart als je ze naar `doel` sleept? Blijft ze in
 * dezelfde kolom, dan verandert er niets. Naar Stopgezet: wie nooit een
 * contract had, is "geen akkoord"; wie al getekend of bezig was, is
 * "vroegtijdig stopgezet".
 */
export function statusVoorKolom(huidig: OpdrachtStatus, doel: KolomKey): OpdrachtStatus {
  if (kolomVan(huidig) === doel) return huidig
  if (doel === 'stopgezet') return kolomRang(kolomVan(huidig)) >= kolomRang('getekend') ? 'geannuleerd' : 'geen_interesse'
  return kolomInfo(doel).standaard
}

// ── Diensten en hun kleur ────────────────────────────────────────────────────

export type DienstKey = 'social_media' | 'grafisch' | 'webdesign' | 'foto_video' | 'branding' | 'consultancy' | 'meta_ads' | 'google_ads' | 'ngs' | 'founders'

export type DienstInfo = {
  key: DienstKey | null
  label: string
  /** Kaartkleur (hele kaart), rand en tekst. */
  achtergrond: string
  rand: string
  tekst: string
  /** Donkere kaart: labels en knoppen in wit. */
  donker: boolean
  /** Andere schrijfwijzen die we als deze dienst herkennen. */
  ook?: string[]
}

export const DIENSTEN: DienstInfo[] = [
  { key: 'social_media', label: 'Sociale media',         achtergrond: '#FFF5C2', rand: '#EBD670', tekst: '#2B2600', donker: false, ook: ['Social media', 'Socials', 'Social media management'] },
  { key: 'grafisch',     label: 'Grafisch ontwerp',      achtergrond: '#FDE0DE', rand: '#F1ACA6', tekst: '#3A1210', donker: false },
  { key: 'webdesign',    label: 'Webdesign',             achtergrond: '#ECE2FB', rand: '#C7AEF0', tekst: '#241446', donker: false },
  { key: 'foto_video',   label: 'Foto & videografie',    achtergrond: '#DCF3E2', rand: '#9CD5AB', tekst: '#0F2E18', donker: false },
  { key: 'branding',     label: 'Branding',              achtergrond: '#FDE0DE', rand: '#F1ACA6', tekst: '#3A1210', donker: false },
  { key: 'consultancy',  label: 'Marketing consultancy', achtergrond: '#F0E4D6', rand: '#D2B694', tekst: '#33240F', donker: false, ook: ['Consultancy'] },
  { key: 'meta_ads',     label: 'Meta ads',              achtergrond: '#D6F4EF', rand: '#8FD4C8', tekst: '#0D302B', donker: false, ook: ['Facebook ads', 'Instagram ads', 'Meta advertenties'] },
  { key: 'google_ads',   label: 'Google ads',            achtergrond: '#FFE6CF', rand: '#F2B47C', tekst: '#3A1F05', donker: false, ook: ['Google advertenties', 'SEA'] },
  { key: 'ngs',          label: 'NextGenSolutions (AI)', achtergrond: '#DDEBFC', rand: '#9FC2EE', tekst: '#0E2440', donker: false, ook: ['NextGenSolutions', 'AI'] },
  { key: 'founders',     label: 'Founders of Flanders',  achtergrond: '#8A5A3B', rand: '#6B4329', tekst: '#FFFFFF', donker: true },
]

/** Kaart zonder dienst: wit. */
export const GEEN_DIENST: DienstInfo = { key: null, label: 'Geen dienst', achtergrond: '#FFFFFF', rand: '#E5E7EB', tekst: '#111827', donker: false }

const sleutelVan = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim()

/** Info van een opgeslagen dienst: een vaste sleutel, een vast label, of eigen tekst (dan zonder kleur). */
export function dienstInfo(v: string): DienstInfo {
  const s = sleutelVan(v)
  const vast = DIENSTEN.find((d) => d.key === v || sleutelVan(d.label) === s || (d.ook ?? []).some((o) => sleutelVan(o) === s))
  return vast ?? { ...GEEN_DIENST, label: v }
}

/** De kleur van de kaart: die van de eerste dienst met een vaste kleur. */
export function kaartKleur(diensten: string[] | null | undefined): DienstInfo {
  for (const d of diensten ?? []) {
    const i = dienstInfo(d)
    if (i.key) return i
  }
  return GEEN_DIENST
}

/**
 * Wat er binnenkomt nakijken: vaste diensten worden hun sleutel, eigen tekst
 * blijft (max. 40 tekens). Geen dubbels, hoogstens 6.
 */
export function normaliseerDiensten(v: unknown): string[] {
  const lijst = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []
  const uit: string[] = []
  for (const ruw of lijst) {
    const s = String(ruw ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    if (!s) continue
    const i = dienstInfo(s)
    const waarde = i.key ?? s
    if (!uit.some((x) => sleutelVan(x) === sleutelVan(waarde))) uit.push(waarde)
    if (uit.length >= 6) break
  }
  return uit
}

/**
 * Een voorstel van diensten op basis van de titel, voor kaarten die er nog
 * geen hebben. Enkel een voorstel: de mens bevestigt.
 */
export function raadDiensten(titel: string | null | undefined): DienstKey[] {
  const t = sleutelVan(String(titel ?? ''))
  const uit: DienstKey[] = []
  const als = (re: RegExp, k: DienstKey) => { if (re.test(t) && !uit.includes(k)) uit.push(k) }
  als(/founders/, 'founders')
  als(/google ads|google advert|adwords|\bsea\b/, 'google_ads')
  als(/meta ads|facebook ads|instagram ads|meta advert|advertising|advertenties|campagne|(?<!google )\bads\b/, 'meta_ads')
  als(/social|instagram(?! ads)|linkedin|facebook(?! ads)|tiktok|community|content(?!shoot)/, 'social_media')
  als(/website|webshop|webdesign|landingspagina|wordpress|\bsite\b|\bweb\b/, 'webdesign')
  als(/huisstijl|branding|logo|merk|identiteit/, 'branding')
  als(/grafisch|flyer|drukwerk|bestickering|sticker|belettering|brochure|affiche|visitekaart|ontwerp/, 'grafisch')
  als(/foto|video|reel|shoot|film|opname|drone/, 'foto_video')
  als(/consultancy|advies|strategie|marketingpartner|marketing partner|business partner|workshop|coaching/, 'consultancy')
  als(/\bai\b|chatbot|automatisatie|automatisering|solutions|\bcrm\b|software|programma|\bapp\b/, 'ngs')
  return uit.slice(0, 3)
}

// ── Bron en offertekanaal ───────────────────────────────────────────────────

export type Bron = 'inbound' | 'outbound'
export const BRONNEN: { key: Bron; label: string; uitleg: string }[] = [
  { key: 'inbound', label: 'Inbound', uitleg: 'De klant kwam zelf met de vraag.' },
  { key: 'outbound', label: 'Outbound', uitleg: 'Wij gingen er zelf op af.' },
]
export const isBron = (v: unknown): v is Bron => v === 'inbound' || v === 'outbound'
export const bronLabel = (v: string | null | undefined): string | null => BRONNEN.find((b) => b.key === v)?.label ?? null

/** Voorstel voor de bron uit de leadbron van de pipeline (website = inbound, outbound = outbound; de rest weten we niet). */
export function bronUitLead(leadbron: string | null | undefined): Bron | null {
  if (leadbron === 'website') return 'inbound'
  if (leadbron === 'outbound' || leadbron === 'harrie') return 'outbound'
  return null
}

export const OFFERTE_VIA: { key: string; label: string }[] = [
  { key: 'mail', label: 'Per mail' },
  { key: 'telefonisch', label: 'Telefonisch' },
  { key: 'meeting', label: 'In een meeting' },
  { key: 'whatsapp', label: 'Via WhatsApp' },
  { key: 'projectvoorstel', label: 'Projectvoorstel (pdf)' },
]
/** Label van het kanaal: een vaste keuze of wat je zelf typte. */
export const offerteViaLabel = (v: string | null | undefined): string | null =>
  !v ? null : OFFERTE_VIA.find((o) => o.key === v)?.label ?? v

/** Vaste sleutel of eigen tekst (max. 60 tekens); leeg = null. */
export function normaliseerVia(v: unknown): string | null {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
  if (!s) return null
  return OFFERTE_VIA.find((o) => o.key === s || o.label.toLowerCase() === s.toLowerCase())?.key ?? s
}

// ── Facturatie: is de volledige waarde gefactureerd? ─────────────────────────

const VERSTUURD = new Set(['verstuurd', 'gefactureerd', 'betaald'])

export type Facturatie = {
  /** Al gefactureerd (verstuurd of betaald), excl. btw. */
  gefactureerd: number
  /** Waarop we afletteren: de contractwaarde (na verminderingen) of het bedrag van de opdracht. Null = onbekend. */
  totaal: number | null
  volledig: boolean
  bron: 'contract' | 'facturen' | null
}

/**
 * Hoeveel van de opdracht is gefactureerd?
 *
 * Met een gekoppeld contract telt de aflettering van dat contract (alle
 * facturen en maandfacturen samen, enkel het deel binnen de contractwaarde).
 * Zonder contract tellen de gekoppelde facturen tegenover het bedrag van de
 * opdracht; zonder bedrag is één verstuurde factuur genoeg als alle gekoppelde
 * facturen de deur uit zijn.
 */
export function facturatieVan(input: {
  contractId?: string | null
  /** Aflettering van het gekoppelde contract in centen (effectief = na verminderingen). */
  aflettering?: { effectiefCent: number | null; gefactureerdCent: number } | null
  facturen?: FactuurKoppeling[]
  bedragExcl?: number | null
}): Facturatie {
  if (input.contractId) {
    const a = input.aflettering
    if (!a) return { gefactureerd: 0, totaal: null, volledig: false, bron: 'contract' }
    const totaal = a.effectiefCent === null ? null : a.effectiefCent / 100
    const volledig = a.effectiefCent !== null && a.effectiefCent > 0 && a.gefactureerdCent >= a.effectiefCent
    return { gefactureerd: a.gefactureerdCent / 100, totaal, volledig, bron: 'contract' }
  }
  const facturen = (input.facturen ?? []).filter((f) => f.status !== 'geannuleerd')
  if (!facturen.length) return { gefactureerd: 0, totaal: input.bedragExcl ?? null, volledig: false, bron: null }
  const verstuurd = facturen.filter((f) => VERSTUURD.has(f.status))
  const somCent = verstuurd.reduce((t, f) => t + Math.round((Number(f.amount_excl) || 0) * 100), 0)
  const bedrag = input.bedragExcl !== null && input.bedragExcl !== undefined && Number(input.bedragExcl) > 0 ? Math.round(Number(input.bedragExcl) * 100) : null
  const volledig = bedrag !== null ? somCent >= bedrag : verstuurd.length > 0 && verstuurd.length === facturen.length
  return { gefactureerd: somCent / 100, totaal: bedrag !== null ? bedrag / 100 : null, volledig, bron: 'facturen' }
}

/**
 * Naar welke status mag een kaart vanzelf? Enkel de drie automatische
 * stappen: contract verstuurd, getekend, en afgerond als alles gefactureerd
 * is. Te factureren of factuur verstuurd zet het bord nooit zelf: In
 * uitvoering is een handmatige stap.
 */
export function automatischeStatus(k: Koppelingen | null | undefined, facturatie: Facturatie | null | undefined): OpdrachtStatus | null {
  if (facturatie?.volledig) return 'afgerond'
  const c = k?.contract?.status
  if (c === 'getekend') return 'getekend'
  if (c === 'verzonden' || c === 'geopend' || c === 'ingevuld') return 'contract_verstuurd'
  return null
}

/** Systeemnotitie bij een verplaatsing, bv. "Naar Offerte gestuurd (per mail)". */
export function verplaatsTekst(van: OpdrachtStatus, naar: OpdrachtStatus, extra?: { via?: string | null; reden?: string | null; automatisch?: string | null }): string | null {
  const a = kolomVan(van), b = kolomVan(naar)
  if (a === b) return van === naar ? null : `Stap: ${stapLabel(van)} → ${stapLabel(naar)}`
  let t = `${extra?.automatisch ? 'Automatisch naar' : 'Naar'} ${kolomInfo(b).label}`
  if (b === 'stopgezet') t = `${stapLabel(naar)}${extra?.reden ? `: ${extra.reden}` : ''}`
  if (b === 'offerte' && extra?.via) t += ` (${offerteViaLabel(extra.via)?.toLowerCase()})`
  if (extra?.automatisch) t += `: ${extra.automatisch}`
  return t
}

/** Volgorde binnen een kolom: wat het langst stilstaat onderaan, recent verplaatst bovenaan. */
export function sorteerInKolom<T extends { status_gewijzigd_op?: string | null; created_at: string }>(a: T, b: T): number {
  return (b.status_gewijzigd_op ?? b.created_at ?? '').localeCompare(a.status_gewijzigd_op ?? a.created_at ?? '')
}

/** Hele dagen sinds een tijdstip (voor "12 d in deze fase"). */
export function dagenSinds(iso: string | null | undefined, nu: Date = new Date()): number | null {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return null
  return Math.max(0, Math.floor((nu.getTime() - t) / 86_400_000))
}

