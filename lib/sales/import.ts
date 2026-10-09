import 'server-only'

// Bulk-import van leads uit een tabelbestand.
//
// BEWUSTE KEUZE: we lezen CSV, geen .xlsx. Een xlsx-parser vraagt een zware
// externe bibliotheek (de bekende npm-variant is niet meer onderhouden en heeft
// een geschiedenis van kwetsbaarheden). Vlak na een securityronde wegen we dat
// niet op tegen "Opslaan als CSV" in Excel — één klik. Zeg het als je toch
// rechtstreeks .xlsx wilt; dan wegen we die dependency apart af.

export type ParsedTable = { headers: string[]; rows: string[][] }

/**
 * CSV lezen met correcte afhandeling van aanhalingstekens, ingesloten komma's,
 * nieuwe regels binnen een veld en verdubbelde quotes ("" = ").
 * Scheidingsteken wordt geraden: Excel in NL/BE exporteert met puntkomma's.
 */
export function parseCsv(text: string): ParsedTable {
  // Byte-order mark van Excel weghalen, anders heet de eerste kolom "﻿naam".
  const src = text.replace(/^﻿/, '')
  const delimiter = guessDelimiter(src)

  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }   // "" = letterlijk quote
        else inQuotes = false
      } else field += c
      continue
    }
    if (c === '"') { inQuotes = true; continue }
    if (c === delimiter) { row.push(field); field = ''; continue }
    if (c === '\r') continue
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue }
    field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }

  const clean = rows.filter((r) => r.some((v) => v.trim() !== ''))
  if (clean.length === 0) return { headers: [], rows: [] }

  const headers = clean[0].map((h) => h.trim())
  return { headers, rows: clean.slice(1).map((r) => headers.map((_, i) => (r[i] ?? '').trim())) }
}

/** Puntkomma of komma? Kijk naar de kop-regel buiten aanhalingstekens. */
function guessDelimiter(src: string): string {
  const firstLine = src.split(/\r?\n/, 1)[0] ?? ''
  let semi = 0, comma = 0, tab = 0, q = false
  for (const c of firstLine) {
    if (c === '"') q = !q
    else if (!q) { if (c === ';') semi++; else if (c === ',') comma++; else if (c === '\t') tab++ }
  }
  if (tab > semi && tab > comma) return '\t'
  return semi >= comma ? ';' : ','
}

// De velden waar een kolom op afgebeeld kan worden.
export const IMPORT_FIELDS = [
  { key: 'company.name',     label: 'Bedrijfsnaam', required: true },
  { key: 'company.website',  label: 'Website' },
  { key: 'company.sector',   label: 'Sector/segment' },
  { key: 'company.activiteit', label: 'Activiteit (omschrijving)' },
  { key: 'company.employees', label: 'Aantal werknemers' },
  { key: 'company.werkklasse', label: 'Werkklasse (bv. 10–19)' },
  { key: 'company.city',     label: 'Stad' },
  { key: 'company.region',   label: 'Provincie/regio' },
  { key: 'company.country',  label: 'Land' },
  { key: 'company.phone',    label: 'Telefoon bedrijf' },
  { key: 'company.email',    label: 'Algemeen e-mailadres' },
  { key: 'company.linkedin', label: 'LinkedIn bedrijf' },
  { key: 'company.ondernemingsnummer', label: 'Ondernemingsnummer' },
  { key: 'company.prioriteit', label: 'Prioriteit (A/B/C)' },
  { key: 'contact.name',     label: 'Contactpersoon' },
  { key: 'contact.role',     label: 'Functie' },
  { key: 'contact.email',    label: 'E-mail contactpersoon' },
  { key: 'contact.phone',    label: 'Telefoon contact' },
  { key: 'contact.mobile',   label: 'GSM / rechtstreeks nummer' },
  { key: 'contact.linkedin', label: 'LinkedIn contact' },
] as const

export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]['key']
export type ColumnMapping = Record<string, ImportFieldKey | ''>   // kolomnaam → veld

const FIELD_KEYS = new Set(IMPORT_FIELDS.map((f) => f.key))

/**
 * Kolommen raden zonder AI. Vangt de gebruikelijke koppen meteen af, zodat de
 * AI-stap alleen nog de vreemde gevallen hoeft op te lossen (en de import ook
 * werkt als er geen AI-sleutel is).
 */
export function guessMapping(headers: string[]): ColumnMapping {
  const rules: [RegExp, ImportFieldKey][] = [
    // ── Het vaste lijstformaat (FAFO-batches) eerst, exact op kopnaam. ──────
    // Deze lijsten zijn de standaard-aanvoer; raden op deelwoorden zou hier
    // fout gaan ("Algemeen e-mail" zou anders bij het contact belanden, en
    // "Sector / activiteit" zou het nette segment overschrijven).
    [/^prioriteit$/i, 'company.prioriteit'],
    [/^segment$/i, 'company.sector'],
    [/^ondernemingsnummer$/i, 'company.ondernemingsnummer'],
    [/^werknemers$/i, 'company.werkklasse'],
    [/^telefoon$/i, 'company.phone'],
    [/algemeen\s*e-?mail/i, 'company.email'],
    [/direct\s*e-?mail/i, 'contact.email'],
    [/mobiel\s*\/?\s*rechtstreeks|rechtstreeks/i, 'contact.mobile'],
    [/functie\s*\/?\s*dmu/i, 'contact.role'],
    [/sector\s*\/?\s*activiteit/i, 'company.activiteit'],
    [/^contactpersoon$/i, 'contact.name'],
    // ── Daarna de generieke regels voor alle andere lijstformaten. ─────────
    [/^(bedrijf|bedrijfsnaam|company|organisatie|organization|account|naam bedrijf)$/i, 'company.name'],
    [/(website|url|site|domein|domain)/i, 'company.website'],
    [/(sector|branche|industry|industrie)/i, 'company.sector'],
    [/(werknemers|employees|medewerkers|size|grootte)/i, 'company.employees'],
    [/(stad|city|gemeente|plaats|woonplaats)/i, 'company.city'],
    [/(provincie|regio|region|state)/i, 'company.region'],
    [/^(land|country)$/i, 'company.country'],
    [/(linkedin).*(bedrijf|company)|company.*linkedin/i, 'company.linkedin'],
    [/(functie|titel|title|role|job)/i, 'contact.role'],
    [/(e-?mail|mail address|emailadres)/i, 'contact.email'],
    [/(gsm|mobiel|mobile|cell)/i, 'contact.mobile'],
    [/(telefoon|phone|tel\b|nummer)/i, 'contact.phone'],
    [/(linkedin)/i, 'contact.linkedin'],
    [/(contact|voornaam|naam|name|persoon)/i, 'contact.name'],
  ]
  const out: ColumnMapping = {}
  const used = new Set<string>()
  for (const h of headers) {
    const hit = rules.find(([re]) => re.test(h.trim()))
    // Elk veld maar één keer toewijzen: twee kolommen op 'contact.name' zou de
    // tweede stil laten winnen.
    if (hit && !used.has(hit[1])) { out[h] = hit[1]; used.add(hit[1]) }
    else out[h] = ''
  }
  return out
}

/** Onbekend/verzonnen veld uit een AI-antwoord filteren. */
export function sanitizeMapping(raw: unknown, headers: string[]): ColumnMapping {
  const out: ColumnMapping = {}
  const used = new Set<string>()
  const src = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {}
  for (const h of headers) {
    const v = String(src[h] ?? '')
    if (FIELD_KEYS.has(v as ImportFieldKey) && !used.has(v)) { out[h] = v as ImportFieldKey; used.add(v) }
    else out[h] = ''
  }
  return out
}

export type MappedRow = {
  company: Record<string, string>
  contact: Record<string, string>
}

/** Rijen omzetten naar lead-invoer volgens de mapping. */
export function applyMapping(table: ParsedTable, mapping: ColumnMapping): MappedRow[] {
  const cols = table.headers.map((h) => mapping[h] ?? '')
  return table.rows.map((r) => {
    const company: Record<string, string> = {}
    const contact: Record<string, string> = {}
    cols.forEach((target, i) => {
      if (!target) return
      const value = (r[i] ?? '').trim()
      if (!value) return
      const [group, field] = target.split('.')
      if (group === 'company') company[field] = value
      else contact[field] = value
    })
    return { company, contact }
  })
}
