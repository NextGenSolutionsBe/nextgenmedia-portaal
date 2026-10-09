// Formulieren — het gedeelde model. CLIENT-VEILIG (geen server-only imports):
// gebruikt door de builder, de publieke pagina, de API-routes én de tests.
//
// Eén plek voor de veldtypes, het opschonen van (onbetrouwbare) JSON, de
// validatie van antwoorden en de sjablonen. De server valideert met exact
// dezelfde functie als de browser, zodat wat de klant ziet en wat wij
// aannemen nooit uit elkaar lopen.

import { SERVICE_LABELS, SERVICE_SLUGS } from '@/lib/utils'

// ── Veldtypes ────────────────────────────────────────────────────────────────

export const VELD_TYPES = [
  'kort', 'lang', 'email', 'telefoon', 'url', 'getal', 'datum',
  'keuze', 'meerkeuze', 'dropdown', 'jaNee', 'schaal', 'kleur', 'bestand',
  'sectie', 'uitleg',
] as const
export type VeldType = (typeof VELD_TYPES)[number]

export const VELD_TYPE_INFO: Record<VeldType, { label: string; uitleg: string }> = {
  kort: { label: 'Korte tekst', uitleg: 'Eén regel, bv. een naam' },
  lang: { label: 'Lange tekst', uitleg: 'Meerdere regels, bv. een omschrijving' },
  email: { label: 'E-mailadres', uitleg: 'Wordt gecontroleerd op een geldig adres' },
  telefoon: { label: 'Telefoon', uitleg: 'Telefoonnummer' },
  url: { label: 'Link / website', uitleg: 'Een webadres' },
  getal: { label: 'Getal', uitleg: 'Met optioneel minimum en maximum' },
  datum: { label: 'Datum', uitleg: 'Datumkiezer' },
  keuze: { label: 'Eén keuze', uitleg: 'Keuzerondjes, één antwoord' },
  meerkeuze: { label: 'Meerdere keuzes', uitleg: 'Vinkjes, meerdere antwoorden' },
  dropdown: { label: 'Keuzelijst', uitleg: 'Uitklaplijst, één antwoord' },
  jaNee: { label: 'Ja / nee', uitleg: 'Eenvoudige ja-of-nee-vraag' },
  schaal: { label: 'Schaal', uitleg: 'Score van 1 tot 5 of 10' },
  kleur: { label: 'Kleur(en)', uitleg: 'Kleurkiezer met hexcode — handig voor huisstijl' },
  bestand: { label: 'Bestand(en)', uitleg: 'Upload: beeld, pdf, ai, eps, svg of zip' },
  sectie: { label: 'Sectietitel', uitleg: 'Tussenkop met optionele tekst' },
  uitleg: { label: 'Uitleg', uitleg: 'Vaste tekst, geen antwoord' },
}

const KEUZE_TYPES: VeldType[] = ['keuze', 'meerkeuze', 'dropdown']
const GEEN_ANTWOORD: VeldType[] = ['sectie', 'uitleg']
/** Types waarop een voorwaarde kan steunen (eenvoudige, vergelijkbare waarde). */
const VOORWAARDE_BRON: VeldType[] = ['kort', 'email', 'telefoon', 'url', 'getal', 'datum', 'keuze', 'meerkeuze', 'dropdown', 'jaNee', 'schaal']

export const heeftOpties = (t: VeldType): boolean => KEUZE_TYPES.includes(t)
export const isAntwoordVeld = (t: VeldType): boolean => !GEEN_ANTWOORD.includes(t)
export const kanVoorwaardeBron = (t: VeldType): boolean => VOORWAARDE_BRON.includes(t)
export const isVeldType = (v: unknown): v is VeldType => typeof v === 'string' && (VELD_TYPES as readonly string[]).includes(v)

export type Voorwaarde = { veld: string; waarde: string }

export type Veld = {
  id: string
  type: VeldType
  label: string
  hulptekst?: string
  verplicht: boolean
  placeholder?: string
  opties?: string[]
  /** getal: bereik · schaal: begin/einde · bestand/kleur: max aantal. */
  min?: number
  max?: number
  /** schaal: tekst bij het laagste / hoogste punt. */
  minLabel?: string
  maxLabel?: string
  /** Toon dit veld enkel als veld X gelijk is aan waarde Y. */
  voorwaarde?: Voorwaarde | null
}

export type BestandAntwoord = { pad: string; naam: string; grootte: number; type: string }
export type Antwoord = string | number | string[] | BestandAntwoord[]
export type Antwoorden = Record<string, Antwoord>

// ── Grenzen ──────────────────────────────────────────────────────────────────

export const MAX_VELDEN = 80
export const MAX_OPTIES = 50
const MAX_LABEL = 200
const MAX_HULP = 1500
const MAX_PLACEHOLDER = 150
const MAX_OPTIE = 200
const MAX_ID = 60
export const MAX_KORT = 500
export const MAX_LANG = 5000

// ── Bestanden ────────────────────────────────────────────────────────────────

export const BESTAND_MAX_BYTES = 20 * 1024 * 1024
export const BESTAND_MAX_AANTAL = 5

/** Witte lijst op extensie, met de mimetypes die browsers ervoor meegeven. */
export const BESTAND_TYPES: Record<string, string[]> = {
  jpg: ['image/jpeg'], jpeg: ['image/jpeg'], png: ['image/png'], webp: ['image/webp'], gif: ['image/gif'],
  heic: ['image/heic'], heif: ['image/heif'], svg: ['image/svg+xml'],
  pdf: ['application/pdf'],
  ai: ['application/postscript', 'application/illustrator', 'application/pdf'],
  eps: ['application/postscript', 'application/eps', 'image/x-eps', 'application/x-eps'],
  zip: ['application/zip', 'application/x-zip-compressed', 'application/x-zip'],
}
export const BESTAND_ACCEPT = Object.keys(BESTAND_TYPES).map((e) => `.${e}`).join(',')
export const BESTAND_EXT_TEKST = 'jpg, png, webp, gif, heic, svg, pdf, ai, eps, zip'

/**
 * Extensie van een upload, of null als het type niet mag. Browsers geven voor
 * .ai/.eps vaak een leeg of generiek mimetype mee — dan beslist de extensie;
 * geeft de browser wél een specifiek type, dan moet dat bij de extensie passen.
 */
export function bestandExtensie(naam: string, mime: string): string | null {
  const ext = String(naam ?? '').toLowerCase().match(/\.([a-z0-9]{1,5})$/)?.[1] ?? ''
  const m = String(mime ?? '').toLowerCase().trim()
  if (!ext || !BESTAND_TYPES[ext]) return null
  if (!m || m === 'application/octet-stream') return ext
  return BESTAND_TYPES[ext].includes(m) ? ext : null
}

/** Pad in de bucket: <formulier>/<link>/<uniek>.<ext>. Het pad kiest altijd de server. */
export function bouwBestandPad(formulierId: string, linkId: string, uniek: string, ext: string): string {
  return `${formulierId}/${linkId}/${uniek}.${ext}`
}

export function padHoortBij(pad: unknown, formulierId: string, linkId: string): boolean {
  return typeof pad === 'string' && pad.startsWith(`${formulierId}/${linkId}/`) && !pad.includes('..') && !pad.includes('//')
}

export function leesbareGrootte(bytes: number | null | undefined): string {
  const n = Number(bytes)
  if (!Number.isFinite(n) || n <= 0) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} kB`
  return `${(n / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`
}

// ── Diensten en statussen ────────────────────────────────────────────────────

export const DIENSTEN: { key: string; label: string }[] = [
  { key: 'algemeen', label: 'Algemeen' },
  ...SERVICE_SLUGS.map((s) => ({ key: s as string, label: SERVICE_LABELS[s] ?? s })),
]
export const dienstLabel = (key: string | null | undefined): string => DIENSTEN.find((d) => d.key === key)?.label ?? 'Algemeen'
export const geldigeDienst = (v: unknown): string => (DIENSTEN.some((d) => d.key === v) ? String(v) : 'algemeen')

export const FORMULIER_STATUSSEN = ['concept', 'actief', 'gesloten'] as const
export type FormulierStatus = (typeof FORMULIER_STATUSSEN)[number]
export const FORMULIER_STATUS_INFO: Record<FormulierStatus, { label: string; kleur: string }> = {
  concept: { label: 'Concept', kleur: 'bg-gray-100 text-gray-600' },
  actief: { label: 'Actief', kleur: 'bg-green-100 text-green-700' },
  gesloten: { label: 'Gesloten', kleur: 'bg-red-100 text-red-700' },
}
export const isFormulierStatus = (v: unknown): v is FormulierStatus => typeof v === 'string' && (FORMULIER_STATUSSEN as readonly string[]).includes(v)

export const INZENDING_STATUSSEN = ['nieuw', 'gezien', 'verwerkt'] as const
export type InzendingStatus = (typeof INZENDING_STATUSSEN)[number]
export const INZENDING_STATUS_INFO: Record<InzendingStatus, { label: string; kleur: string }> = {
  nieuw: { label: 'Nieuw', kleur: 'bg-[#fff848]/40 text-gray-900' },
  gezien: { label: 'Gezien', kleur: 'bg-blue-100 text-blue-700' },
  verwerkt: { label: 'Verwerkt', kleur: 'bg-green-100 text-green-700' },
}
export const isInzendingStatus = (v: unknown): v is InzendingStatus => typeof v === 'string' && (INZENDING_STATUSSEN as readonly string[]).includes(v)

// ── Instellingen van een formulier ───────────────────────────────────────────

export type FormulierInstellingen = { bedankt_tekst: string; knop_tekst: string; meerdere_inzendingen: boolean }
export const STANDAARD_INSTELLINGEN: FormulierInstellingen = {
  bedankt_tekst: 'Bedankt! We hebben je antwoorden goed ontvangen en nemen snel contact met je op.',
  knop_tekst: 'Versturen',
  meerdere_inzendingen: true,
}
export function normaliseerInstellingen(input: unknown): FormulierInstellingen {
  const o = input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {}
  const tekst = (v: unknown, max: number, std: string) => { const s = typeof v === 'string' ? v.trim().slice(0, max) : ''; return s || std }
  return {
    bedankt_tekst: tekst(o.bedankt_tekst, 2000, STANDAARD_INSTELLINGEN.bedankt_tekst),
    knop_tekst: tekst(o.knop_tekst, 60, STANDAARD_INSTELLINGEN.knop_tekst),
    meerdere_inzendingen: typeof o.meerdere_inzendingen === 'boolean' ? o.meerdere_inzendingen : STANDAARD_INSTELLINGEN.meerdere_inzendingen,
  }
}

// ── Links ────────────────────────────────────────────────────────────────────

export type LinkStatus = 'ok' | 'onbekend' | 'ingetrokken' | 'verlopen' | 'gesloten' | 'gebruikt'
export const LINK_STATUS_LABEL: Record<LinkStatus, string> = {
  ok: 'Actief', onbekend: 'Onbekend', ingetrokken: 'Ingetrokken', verlopen: 'Verlopen', gesloten: 'Formulier niet actief', gebruikt: 'Gebruikt',
}

/** Mag er via deze link (nog) ingevuld worden? Eén regel voor pagina, upload en inzending. */
export function linkStatusVan(
  link: { ingetrokken_op?: string | null; verloopt_op?: string | null; eenmalig?: boolean | null } | null,
  formulier: { status?: string | null; gearchiveerd_op?: string | null; instellingen?: unknown } | null,
  aantalInzendingen: number,
  nu: Date = new Date(),
): LinkStatus {
  if (!link || !formulier) return 'onbekend'
  if (link.ingetrokken_op) return 'ingetrokken'
  if (link.verloopt_op && new Date(link.verloopt_op).getTime() < nu.getTime()) return 'verlopen'
  if (formulier.gearchiveerd_op || formulier.status !== 'actief') return 'gesloten'
  const eenKeer = !!link.eenmalig || !normaliseerInstellingen(formulier.instellingen).meerdere_inzendingen
  if (eenKeer && aantalInzendingen > 0) return 'gebruikt'
  return 'ok'
}

// ── Velden opschonen ─────────────────────────────────────────────────────────

/** Namen die een AI (of oudere data) soms gebruikt, vertaald naar onze types. */
const TYPE_ALIAS: Record<string, VeldType> = {
  text: 'kort', short: 'kort', shorttext: 'kort', tekst: 'kort', input: 'kort',
  textarea: 'lang', long: 'lang', longtext: 'lang', paragraph_text: 'lang',
  mail: 'email', phone: 'telefoon', tel: 'telefoon', link: 'url', website: 'url',
  number: 'getal', nummer: 'getal', date: 'datum',
  radio: 'keuze', choice: 'keuze', single: 'keuze',
  checkbox: 'meerkeuze', checkboxes: 'meerkeuze', multi: 'meerkeuze', multiple: 'meerkeuze',
  select: 'dropdown', keuzelijst: 'dropdown',
  janee: 'jaNee', yesno: 'jaNee', boolean: 'jaNee', ja_nee: 'jaNee',
  rating: 'schaal', scale: 'schaal', score: 'schaal',
  color: 'kleur', colour: 'kleur', kleuren: 'kleur',
  file: 'bestand', upload: 'bestand', bestanden: 'bestand',
  section: 'sectie', heading: 'sectie', titel: 'sectie',
  info: 'uitleg', paragraph: 'uitleg', tekstblok: 'uitleg',
}

function leesType(v: unknown): VeldType | null {
  if (isVeldType(v)) return v
  const s = String(v ?? '').trim()
  if (isVeldType(s)) return s
  return TYPE_ALIAS[s.toLowerCase().replace(/[\s-]/g, '')] ?? TYPE_ALIAS[s.toLowerCase()] ?? null
}

const schoneTekst = (v: unknown, max: number): string => String(v ?? '').replace(/[ --]/g, '').trim().slice(0, max)

/** Stabiele, leesbare id uit tekst: kleine letters, cijfers en underscores. */
export function slug(tekst: string): string {
  return String(tekst ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    .slice(0, MAX_ID)
}

const eindigGetal = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}
const klem = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/**
 * Onbetrouwbare JSON (AI-voorstel, API-invoer, oude data) omzetten naar een
 * geldige veldenlijst: enkel gekende types, ingekorte teksten, unieke ids,
 * max 80 velden, en voorwaarden die enkel naar een EERDER veld wijzen (zo kan
 * er nooit een kringverwijzing ontstaan).
 */
export function normaliseerVelden(input: unknown): Veld[] {
  const lijst: unknown[] = Array.isArray(input)
    ? input
    : input && typeof input === 'object' && Array.isArray((input as { velden?: unknown }).velden)
      ? (input as { velden: unknown[] }).velden
      : []

  const uit: Veld[] = []
  const gebruikt = new Set<string>()
  const ruwNaarId = new Map<string, string>()
  const ruweVoorwaarden: (unknown)[] = []

  for (const ruw of lijst) {
    if (uit.length >= MAX_VELDEN) break
    if (!ruw || typeof ruw !== 'object' || Array.isArray(ruw)) continue
    const r = ruw as Record<string, unknown>
    const type = leesType(r.type)
    if (!type) continue

    let label = schoneTekst(r.label ?? r.titel ?? r.vraag, MAX_LABEL)
    if (!label && type !== 'uitleg') label = VELD_TYPE_INFO[type].label

    // Id: bestaande id (opgeschoond) of uit het label; uniek maken met een volgnummer.
    const ruweId = typeof r.id === 'string' ? r.id : ''
    let basis = slug(ruweId) || slug(label) || type.toLowerCase()
    if (/^[0-9]/.test(basis)) basis = `v_${basis}`.slice(0, MAX_ID)
    let id = basis
    for (let i = 2; gebruikt.has(id); i++) id = `${basis.slice(0, MAX_ID - String(i).length - 1)}_${i}`
    gebruikt.add(id)
    if (ruweId && !ruwNaarId.has(ruweId)) ruwNaarId.set(ruweId, id)

    const veld: Veld = { id, type, label, verplicht: isAntwoordVeld(type) ? r.verplicht === true || r.required === true : false }
    const hulp = schoneTekst(r.hulptekst ?? r.help ?? r.beschrijving ?? r.tekst, MAX_HULP)
    if (hulp) veld.hulptekst = hulp
    const ph = schoneTekst(r.placeholder, MAX_PLACEHOLDER)
    if (ph && ['kort', 'lang', 'email', 'telefoon', 'url', 'getal'].includes(type)) veld.placeholder = ph

    if (heeftOpties(type)) {
      const bron = Array.isArray(r.opties) ? r.opties : Array.isArray(r.options) ? r.options : []
      const opties: string[] = []
      for (const o of bron) {
        const t = schoneTekst(typeof o === 'object' && o ? (o as { label?: unknown }).label : o, MAX_OPTIE)
        if (t && !opties.some((x) => x.toLowerCase() === t.toLowerCase())) opties.push(t)
        if (opties.length >= MAX_OPTIES) break
      }
      veld.opties = opties.length ? opties : ['Optie 1', 'Optie 2']
    }

    if (type === 'getal') {
      const min = eindigGetal(r.min), max = eindigGetal(r.max)
      if (min !== undefined) veld.min = min
      if (max !== undefined) veld.max = max
      if (veld.min !== undefined && veld.max !== undefined && veld.min > veld.max) { const t = veld.min; veld.min = veld.max; veld.max = t }
    } else if (type === 'schaal') {
      veld.min = eindigGetal(r.min) === 0 ? 0 : 1
      veld.max = klem(Math.round(eindigGetal(r.max) ?? 5), 2, 10)
      const lo = schoneTekst(r.minLabel, 60), hi = schoneTekst(r.maxLabel, 60)
      if (lo) veld.minLabel = lo
      if (hi) veld.maxLabel = hi
    } else if (type === 'bestand') {
      veld.max = klem(Math.round(eindigGetal(r.max) ?? BESTAND_MAX_AANTAL), 1, BESTAND_MAX_AANTAL)
    } else if (type === 'kleur') {
      veld.max = klem(Math.round(eindigGetal(r.max) ?? 3), 1, 10)
    }

    uit.push(veld)
    ruweVoorwaarden.push(r.voorwaarde)
  }

  // Voorwaarden pas nu: alle ids liggen vast. Enkel naar een eerder, geschikt veld.
  uit.forEach((veld, i) => {
    const v = ruweVoorwaarden[i]
    if (!v || typeof v !== 'object') return
    const rv = v as Record<string, unknown>
    const ruwDoel = String(rv.veld ?? '')
    const doelId = ruwNaarId.get(ruwDoel) ?? ruwDoel
    const doelIndex = uit.findIndex((x) => x.id === doelId)
    const waarde = schoneTekst(rv.waarde, MAX_OPTIE)
    if (doelIndex < 0 || doelIndex >= i || !waarde || !kanVoorwaardeBron(uit[doelIndex].type)) return
    veld.voorwaarde = { veld: doelId, waarde }
  })

  return uit
}

/**
 * Velden (bv. een AI-voorstel) achteraan toevoegen. Botsende ids in de nieuwe
 * velden krijgen een andere id — ook in hun eigen voorwaarden — zodat een
 * voorwaarde nooit per ongeluk naar een bestaand veld gaat wijzen.
 */
export function voegVeldenSamen(bestaand: Veld[], extra: Veld[]): Veld[] {
  const ids = new Set(bestaand.map((v) => v.id))
  const hernoemd = new Map<string, string>()
  const nieuw = extra.map((v) => {
    let id = v.id
    for (let i = 2; ids.has(id); i++) id = `${v.id.slice(0, MAX_ID - String(i).length - 1)}_${i}`
    ids.add(id)
    if (id !== v.id) hernoemd.set(v.id, id)
    return { ...v, id }
  }).map((v) => (v.voorwaarde && hernoemd.has(v.voorwaarde.veld) ? { ...v, voorwaarde: { ...v.voorwaarde, veld: hernoemd.get(v.voorwaarde.veld)! } } : v))
  return normaliseerVelden([...bestaand, ...nieuw])
}

let teller = 0
/** Een nieuw, leeg veld van dit type met een unieke id. */
export function nieuwVeld(type: VeldType, bestaandeIds: Iterable<string> = []): Veld {
  const ids = new Set(bestaandeIds)
  let id = ''
  do { id = `${type.toLowerCase()}_${Date.now().toString(36).slice(-4)}${(teller++).toString(36)}` } while (ids.has(id))
  const veld: Veld = { id, type, label: type === 'uitleg' ? '' : VELD_TYPE_INFO[type].label, verplicht: false }
  if (type === 'uitleg') veld.hulptekst = 'Schrijf hier je uitleg.'
  if (heeftOpties(type)) veld.opties = ['Optie 1', 'Optie 2']
  if (type === 'schaal') { veld.min = 1; veld.max = 5 }
  if (type === 'bestand') veld.max = BESTAND_MAX_AANTAL
  if (type === 'kleur') veld.max = 3
  return veld
}

// ── Voorwaarden ──────────────────────────────────────────────────────────────

function waardeKomtOvereen(antwoord: unknown, waarde: string): boolean {
  const doel = waarde.trim().toLowerCase()
  if (Array.isArray(antwoord)) return antwoord.some((a) => String(a).trim().toLowerCase() === doel)
  if (antwoord === null || antwoord === undefined) return false
  return String(antwoord).trim().toLowerCase() === doel
}

/** Is dit veld zichtbaar gegeven de antwoorden? Een verborgen bronveld verbergt ook zijn afhankelijken. */
export function isZichtbaar(veld: Veld, velden: Veld[], antwoorden: Record<string, unknown>, diepte = 0): boolean {
  if (!veld.voorwaarde) return true
  if (diepte > MAX_VELDEN) return false
  const bron = velden.find((v) => v.id === veld.voorwaarde!.veld)
  if (!bron) return true
  if (!isZichtbaar(bron, velden, antwoorden, diepte + 1)) return false
  return waardeKomtOvereen(antwoorden[bron.id], veld.voorwaarde.waarde)
}

// ── Antwoorden valideren ─────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/
const HEX_RE = /^#[0-9a-f]{6}$/i

function leesUrl(s: string): string | null {
  const t = /^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`
  try {
    const u = new URL(t)
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname.includes('.')) return null
    return t
  } catch { return null }
}

const isLeeg = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0)

export type Validatie = { ok: boolean; fouten: Record<string, string>; schoon: Antwoorden }

/**
 * Antwoorden controleren tegen de velden. Onzichtbare velden (voorwaarde niet
 * voldaan) worden overgeslagen en hun antwoorden weggelaten. `schoon` bevat
 * enkel wat bewaard mag worden, in de juiste vorm.
 *
 * `padPrefix` (server): elk bestandspad moet daarmee beginnen — zo kan een
 * inzender nooit naar een bestand van een ander formulier verwijzen.
 */
export function valideerAntwoorden(velden: Veld[], antwoorden: unknown, opts: { padPrefix?: string } = {}): Validatie {
  const inv = antwoorden && typeof antwoorden === 'object' && !Array.isArray(antwoorden) ? (antwoorden as Record<string, unknown>) : {}
  const fouten: Record<string, string> = {}
  const schoon: Antwoorden = {}

  for (const veld of velden) {
    if (!isAntwoordVeld(veld.type)) continue
    if (!isZichtbaar(veld, velden, inv)) continue
    const ruw = inv[veld.id]

    if (isLeeg(ruw)) {
      if (veld.verplicht) fouten[veld.id] = veld.type === 'bestand' ? 'Voeg minstens één bestand toe.' : heeftOpties(veld.type) || veld.type === 'jaNee' || veld.type === 'schaal' ? 'Maak een keuze.' : 'Dit veld is verplicht.'
      continue
    }

    const tekst = typeof ruw === 'string' || typeof ruw === 'number' ? String(ruw).trim() : ''
    switch (veld.type) {
      case 'kort':
      case 'lang': {
        if (typeof ruw !== 'string') { fouten[veld.id] = 'Ongeldige invoer.'; break }
        const max = veld.type === 'kort' ? MAX_KORT : MAX_LANG
        if (tekst.length > max) { fouten[veld.id] = `Maximaal ${max} tekens.`; break }
        schoon[veld.id] = tekst
        break
      }
      case 'email': {
        if (!EMAIL_RE.test(tekst) || tekst.length > 254) { fouten[veld.id] = 'Vul een geldig e-mailadres in.'; break }
        schoon[veld.id] = tekst.toLowerCase()
        break
      }
      case 'telefoon': {
        const cijfers = tekst.replace(/\D/g, '')
        if (!/^[+0-9 ()./-]+$/.test(tekst) || cijfers.length < 6 || cijfers.length > 16) { fouten[veld.id] = 'Vul een geldig telefoonnummer in.'; break }
        schoon[veld.id] = tekst
        break
      }
      case 'url': {
        const u = tekst.length <= 2000 ? leesUrl(tekst) : null
        if (!u) { fouten[veld.id] = 'Vul een geldig webadres in (bv. www.voorbeeld.be).'; break }
        schoon[veld.id] = u
        break
      }
      case 'getal': {
        const n = Number(tekst.replace(',', '.'))
        if (!tekst || !Number.isFinite(n)) { fouten[veld.id] = 'Vul een getal in.'; break }
        if (veld.min !== undefined && n < veld.min) { fouten[veld.id] = `Minimaal ${veld.min}.`; break }
        if (veld.max !== undefined && n > veld.max) { fouten[veld.id] = `Maximaal ${veld.max}.`; break }
        schoon[veld.id] = n
        break
      }
      case 'datum': {
        const d = /^\d{4}-\d{2}-\d{2}$/.test(tekst) ? new Date(`${tekst}T00:00:00Z`) : null
        if (!d || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== tekst) { fouten[veld.id] = 'Kies een geldige datum.'; break }
        schoon[veld.id] = tekst
        break
      }
      case 'keuze':
      case 'dropdown': {
        const optie = (veld.opties ?? []).find((o) => o === tekst)
        if (!optie) { fouten[veld.id] = 'Kies een van de mogelijkheden.'; break }
        schoon[veld.id] = optie
        break
      }
      case 'meerkeuze': {
        const lijst = Array.isArray(ruw) ? ruw.map((x) => String(x)) : []
        const toegestaan = veld.opties ?? []
        if (lijst.length === 0 || lijst.some((x) => !toegestaan.includes(x))) { fouten[veld.id] = 'Kies uit de mogelijkheden.'; break }
        schoon[veld.id] = toegestaan.filter((o) => lijst.includes(o))
        break
      }
      case 'jaNee': {
        if (tekst !== 'ja' && tekst !== 'nee') { fouten[veld.id] = 'Kies ja of nee.'; break }
        schoon[veld.id] = tekst
        break
      }
      case 'schaal': {
        const n = Number(tekst)
        const lo = veld.min ?? 1, hi = veld.max ?? 5
        if (!Number.isInteger(n) || n < lo || n > hi) { fouten[veld.id] = `Kies een score van ${lo} tot ${hi}.`; break }
        schoon[veld.id] = n
        break
      }
      case 'kleur': {
        const lijst = (Array.isArray(ruw) ? ruw : [ruw]).map((x) => String(x ?? '').trim()).filter(Boolean)
        const max = veld.max ?? 3
        if (lijst.some((x) => !HEX_RE.test(x))) { fouten[veld.id] = 'Gebruik een geldige kleurcode (bv. #1A2B3C).'; break }
        if (lijst.length > max) { fouten[veld.id] = `Maximaal ${max} kleur${max === 1 ? '' : 'en'}.`; break }
        if (lijst.length === 0) { if (veld.verplicht) fouten[veld.id] = 'Kies minstens één kleur.'; break }
        schoon[veld.id] = lijst.map((x) => x.toLowerCase())
        break
      }
      case 'bestand': {
        const lijst = Array.isArray(ruw) ? ruw : []
        const max = veld.max ?? BESTAND_MAX_AANTAL
        if (lijst.length > max) { fouten[veld.id] = `Maximaal ${max} bestand${max === 1 ? '' : 'en'}.`; break }
        const bestanden: BestandAntwoord[] = []
        let fout = ''
        for (const b of lijst) {
          const o = b && typeof b === 'object' ? (b as Record<string, unknown>) : null
          const pad = typeof o?.pad === 'string' ? o.pad : ''
          const naam = schoneTekst(o?.naam, 200) || 'bestand'
          const grootte = Number(o?.grootte)
          if (!pad || pad.includes('..') || (opts.padPrefix && !pad.startsWith(opts.padPrefix))) { fout = 'Een bestand hoort niet bij dit formulier. Upload het opnieuw.'; break }
          if (!bestandExtensie(pad, '')) { fout = 'Dit bestandstype is niet toegestaan.'; break }
          if (Number.isFinite(grootte) && grootte > BESTAND_MAX_BYTES) { fout = `Een bestand is groter dan ${leesbareGrootte(BESTAND_MAX_BYTES)}.`; break }
          bestanden.push({ pad, naam, grootte: Number.isFinite(grootte) ? grootte : 0, type: schoneTekst(o?.type, 100) })
        }
        if (fout) { fouten[veld.id] = fout; break }
        schoon[veld.id] = bestanden
        break
      }
    }
  }

  return { ok: Object.keys(fouten).length === 0, fouten, schoon }
}

// ── Weergave van antwoorden ──────────────────────────────────────────────────

/** Eén antwoord als leesbare tekst (kopiëren, Excel). */
export function antwoordTekst(veld: Pick<Veld, 'type'>, waarde: unknown): string {
  if (isLeeg(waarde)) return ''
  if (veld.type === 'bestand' && Array.isArray(waarde)) return waarde.map((b) => (b && typeof b === 'object' ? String((b as BestandAntwoord).naam ?? '') : String(b))).join(', ')
  if (veld.type === 'jaNee') return waarde === 'ja' ? 'Ja' : waarde === 'nee' ? 'Nee' : String(waarde)
  if (Array.isArray(waarde)) return waarde.map((x) => String(x)).join(', ')
  return String(waarde)
}

/** De hele inzending als platte tekst, met sectietitels. */
export function alsTekst(velden: Veld[], antwoorden: Record<string, unknown>): string {
  const regels: string[] = []
  for (const v of velden) {
    if (v.type === 'sectie') { regels.push('', `## ${v.label}`); continue }
    if (!isAntwoordVeld(v.type)) continue
    if (!(v.id in antwoorden)) continue
    regels.push(`${v.label}: ${antwoordTekst(v, antwoorden[v.id]) || '—'}`)
  }
  return regels.join('\n').trim()
}

/** Naam en e-mail uit de inzending halen (eerste passende velden). */
export function haalContactUit(velden: Veld[], antwoorden: Antwoorden): { naam: string | null; email: string | null } {
  const emailVeld = velden.find((v) => v.type === 'email' && typeof antwoorden[v.id] === 'string')
  const email = emailVeld ? String(antwoorden[emailVeld.id]).slice(0, 254) : null
  const tekstVelden = velden.filter((v) => v.type === 'kort' && typeof antwoorden[v.id] === 'string' && String(antwoorden[v.id]).trim())
  const tekstVan = (v: Veld) => `${v.id.replace(/_/g, ' ')} ${v.label}`.toLowerCase()
  const bedrijf = /bedrijf|firma|onderneming|zaak/
  const persoon = tekstVelden.filter((v) => !bedrijf.test(tekstVan(v))).find((v) => /contactpersoon|voornaam|\bnaam\b|\bname\b/.test(tekstVan(v)))
  const kandidaat = persoon ?? tekstVelden.find((v) => bedrijf.test(tekstVan(v)))
  const naam = kandidaat ? String(antwoorden[kandidaat.id]).trim().slice(0, 200) : null
  return { naam, email }
}

// ── Sjablonen ────────────────────────────────────────────────────────────────

export type Sjabloon = { key: string; titel: string; beschrijving: string; dienst: string; doel: string; velden: Veld[] }

const v = (x: Partial<Veld> & { id: string; type: VeldType; label: string }): Veld => ({ verplicht: false, ...x })

export const SJABLONEN: Sjabloon[] = [
  {
    key: 'huisstijl',
    titel: 'Intake huisstijl & logo',
    beschrijving: 'Vertel ons zoveel mogelijk over je bedrijf en je smaak. Zo kunnen we een huisstijl ontwerpen die echt bij je past. Invullen duurt ongeveer 10 minuten.',
    dienst: 'grafisch-ontwerp',
    doel: 'Intake huisstijl',
    velden: [
      v({ id: 's_bedrijf', type: 'sectie', label: 'Over je bedrijf' }),
      v({ id: 'bedrijfsnaam', type: 'kort', label: 'Bedrijfsnaam', verplicht: true }),
      v({ id: 'contactpersoon', type: 'kort', label: 'Contactpersoon', verplicht: true }),
      v({ id: 'email', type: 'email', label: 'E-mailadres', verplicht: true }),
      v({ id: 'telefoon', type: 'telefoon', label: 'Telefoonnummer' }),
      v({ id: 'website', type: 'url', label: 'Huidige website', placeholder: 'www.jouwbedrijf.be' }),
      v({ id: 'sector', type: 'kort', label: 'Sector / branche', verplicht: true, placeholder: 'bv. bakkerij, bouw, coaching' }),
      v({ id: 'activiteit', type: 'lang', label: 'Wat doet je bedrijf precies?', verplicht: true, hulptekst: 'Beschrijf je producten of diensten in een paar zinnen.' }),
      v({ id: 'doelgroep', type: 'lang', label: 'Wie is je doelgroep?', verplicht: true, hulptekst: 'Leeftijd, type klant, regio, particulier of zakelijk…' }),
      v({ id: 'kernwaarden', type: 'lang', label: 'Wat zijn je kernwaarden?', hulptekst: 'Drie à vijf woorden die je bedrijf typeren, bv. betrouwbaar, lokaal, innovatief.' }),
      v({ id: 'concurrenten', type: 'lang', label: 'Wie zijn je belangrijkste concurrenten?' }),
      v({ id: 's_stijl', type: 'sectie', label: 'Stijl & uitstraling' }),
      v({ id: 'uitstraling', type: 'meerkeuze', label: 'Welke uitstraling zoek je?', verplicht: true, opties: ['Modern', 'Klassiek', 'Speels', 'Luxe', 'Minimalistisch', 'Stoer', 'Warm & persoonlijk', 'Zakelijk', 'Ambachtelijk', 'Technisch'] }),
      v({ id: 'kleuren_wel', type: 'kleur', label: 'Kleuren die je graag ziet', max: 5, hulptekst: 'Kies gerust meerdere kleuren. Geen idee? Laat leeg, dan stellen wij iets voor.' }),
      v({ id: 'kleuren_niet', type: 'kleur', label: 'Kleuren die je absoluut niet wil', max: 5 }),
      v({ id: 'voorbeelden', type: 'lang', label: 'Logo\'s of huisstijlen die je mooi vindt', hulptekst: 'Plak links of beschrijf wat je aanspreekt en waarom.' }),
      v({ id: 'voorbeeld_bestanden', type: 'bestand', label: 'Voorbeeldbeelden (optioneel)', max: 5 }),
      v({ id: 'heeft_logo', type: 'jaNee', label: 'Heb je al een logo?', verplicht: true }),
      v({ id: 'bestaand_logo', type: 'bestand', label: 'Upload je huidige logo', max: 3, voorwaarde: { veld: 'heeft_logo', waarde: 'ja' } }),
      v({ id: 'logo_behouden', type: 'keuze', label: 'Wat wil je met je huidige logo?', opties: ['Volledig nieuw logo', 'Opfrissing van het bestaande logo', 'Logo behouden, enkel huisstijl errond'], voorwaarde: { veld: 'heeft_logo', waarde: 'ja' } }),
      v({ id: 's_toepassing', type: 'sectie', label: 'Toepassingen & planning' }),
      v({ id: 'toepassingen', type: 'meerkeuze', label: 'Waar ga je de huisstijl gebruiken?', verplicht: true, opties: ['Visitekaartjes', 'Briefpapier', 'Website', 'Social media', 'Bestickering (wagen, raam)', 'Kledij', 'Verpakking', 'Flyers / folders', 'Signalisatie / borden', 'Presentaties'] }),
      v({ id: 'deadline', type: 'datum', label: 'Wanneer wil je de huisstijl klaar hebben?' }),
      v({ id: 'budget', type: 'dropdown', label: 'Welk budget heb je voorzien?', opties: ['Minder dan € 500', '€ 500 – € 1.000', '€ 1.000 – € 2.500', '€ 2.500 – € 5.000', 'Meer dan € 5.000', 'Weet ik nog niet'] }),
      v({ id: 'opmerkingen', type: 'lang', label: 'Nog iets dat we moeten weten?' }),
    ],
  },
  {
    key: 'grafisch',
    titel: 'Intake grafisch ontwerp (drukwerk / flyer)',
    beschrijving: 'Heb je een flyer, folder, affiche of ander drukwerk nodig? Vul deze korte briefing in, dan gaan we meteen aan de slag.',
    dienst: 'grafisch-ontwerp',
    doel: 'Intake grafisch ontwerp',
    velden: [
      v({ id: 's_contact', type: 'sectie', label: 'Je gegevens' }),
      v({ id: 'bedrijfsnaam', type: 'kort', label: 'Bedrijfsnaam', verplicht: true }),
      v({ id: 'contactpersoon', type: 'kort', label: 'Contactpersoon', verplicht: true }),
      v({ id: 'email', type: 'email', label: 'E-mailadres', verplicht: true }),
      v({ id: 'telefoon', type: 'telefoon', label: 'Telefoonnummer' }),
      v({ id: 's_opdracht', type: 'sectie', label: 'De opdracht' }),
      v({ id: 'soort', type: 'meerkeuze', label: 'Wat moeten we ontwerpen?', verplicht: true, opties: ['Flyer', 'Folder / brochure', 'Affiche', 'Roll-up / banner', 'Visitekaartjes', 'Menukaart', 'Advertentie', 'Uitnodiging', 'Social media visual', 'Iets anders'] }),
      v({ id: 'soort_anders', type: 'kort', label: 'Wat precies?', voorwaarde: { veld: 'soort', waarde: 'Iets anders' } }),
      v({ id: 'formaat', type: 'dropdown', label: 'Formaat', opties: ['A6', 'A5', 'A4', 'A3', 'A2 of groter', 'Vierkant', 'Weet ik nog niet / advies gewenst'] }),
      v({ id: 'doel_ontwerp', type: 'lang', label: 'Wat is het doel van het ontwerp?', verplicht: true, hulptekst: 'bv. een actie aankondigen, een event promoten, je diensten voorstellen.' }),
      v({ id: 'doelgroep', type: 'kort', label: 'Voor wie is het bedoeld?' }),
      v({ id: 'teksten', type: 'lang', label: 'Welke teksten moeten erop?', hulptekst: 'Titel, slogan, prijzen, contactgegevens… Of upload een document hieronder.' }),
      v({ id: 'materiaal', type: 'bestand', label: 'Logo, foto\'s of teksten', max: 5 }),
      v({ id: 'huisstijl', type: 'jaNee', label: 'Heb je een huisstijl die we moeten volgen?' }),
      v({ id: 'huisstijl_kleuren', type: 'kleur', label: 'Huisstijlkleuren', max: 5, voorwaarde: { veld: 'huisstijl', waarde: 'ja' } }),
      v({ id: 'stijl', type: 'meerkeuze', label: 'Gewenste stijl', opties: ['Modern', 'Klassiek', 'Speels', 'Luxe', 'Minimalistisch', 'Opvallend'] }),
      v({ id: 'drukwerk', type: 'keuze', label: 'Moeten wij het ook laten drukken?', opties: ['Ja, graag', 'Nee, enkel het ontwerp', 'Weet ik nog niet'] }),
      v({ id: 'oplage', type: 'getal', label: 'Gewenste oplage (aantal stuks)', min: 1, voorwaarde: { veld: 'drukwerk', waarde: 'Ja, graag' } }),
      v({ id: 'deadline', type: 'datum', label: 'Deadline', verplicht: true }),
      v({ id: 'opmerkingen', type: 'lang', label: 'Opmerkingen' }),
    ],
  },
  {
    key: 'algemeen',
    titel: 'Algemene intake',
    beschrijving: 'Vertel ons kort wie je bent en waarmee we je kunnen helpen. We nemen zo snel mogelijk contact met je op.',
    dienst: 'algemeen',
    doel: 'Algemene intake',
    velden: [
      v({ id: 'bedrijfsnaam', type: 'kort', label: 'Bedrijfsnaam' }),
      v({ id: 'contactpersoon', type: 'kort', label: 'Naam', verplicht: true }),
      v({ id: 'email', type: 'email', label: 'E-mailadres', verplicht: true }),
      v({ id: 'telefoon', type: 'telefoon', label: 'Telefoonnummer' }),
      v({ id: 'website', type: 'url', label: 'Website' }),
      v({ id: 'diensten', type: 'meerkeuze', label: 'Waarvoor wil je samenwerken?', verplicht: true, opties: ['Social media', 'Website', 'Grafisch ontwerp / huisstijl', 'Foto & video', 'Google Ads', 'Marketingadvies', 'Iets anders'] }),
      v({ id: 'vraag', type: 'lang', label: 'Beschrijf je vraag of project', verplicht: true }),
      v({ id: 'timing', type: 'dropdown', label: 'Wanneer wil je starten?', opties: ['Zo snel mogelijk', 'Binnen de maand', 'Binnen 3 maanden', 'Later / oriënterend'] }),
      v({ id: 'budget', type: 'dropdown', label: 'Budgetindicatie', opties: ['Minder dan € 1.000', '€ 1.000 – € 3.000', '€ 3.000 – € 7.500', 'Meer dan € 7.500', 'Weet ik nog niet'] }),
      v({ id: 'contact_voorkeur', type: 'keuze', label: 'Hoe mogen we je contacteren?', opties: ['Telefoon', 'E-mail', 'Maakt niet uit'] }),
      v({ id: 'opmerkingen', type: 'lang', label: 'Nog iets?' }),
    ],
  },
]
