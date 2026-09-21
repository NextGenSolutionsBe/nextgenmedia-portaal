// Facturatieplanner — PUUR model (client-safe, testbaar): statussen, filters,
// datumrekenen op 'YYYY-MM-DD'-strings (nooit via de lokale tijdzone), en de
// samenvatting bovenaan het dashboard. Eén bron voor kalender én lijst.

import { lastDayOfMonth, shiftYM } from '@/lib/invoices'

// ── Statussen ────────────────────────────────────────────────────────────────
export type PlannerStatus = 'gepland' | 'te_versturen' | 'controle_vereist' | 'verstuurd' | 'betaald' | 'achterstallig' | 'geannuleerd' | 'gecrediteerd'

export const PLANNER_STATUSSEN: { key: PlannerStatus; label: string; cls: string; stip: string }[] = [
  // Grijs = te versturen (gepland of vandaag), groen = verstuurd, rood = geannuleerd/gecrediteerd — dezelfde kleuren als in Facturen en op het contract.
  { key: 'gepland', label: 'Te versturen (gepland)', cls: 'bg-gray-50 text-gray-600 border-gray-200', stip: 'bg-gray-300' },
  { key: 'te_versturen', label: 'Te versturen', cls: 'bg-gray-100 text-gray-800 border-gray-300', stip: 'bg-gray-500' },
  { key: 'controle_vereist', label: 'Controle vereist', cls: 'bg-amber-50 text-amber-800 border-amber-200', stip: 'bg-amber-500' },
  { key: 'verstuurd', label: 'Verstuurd', cls: 'bg-green-100 text-green-800 border-green-200', stip: 'bg-green-500' },
  { key: 'betaald', label: 'Betaald', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200', stip: 'bg-emerald-600' },
  { key: 'achterstallig', label: 'Te versturen · datum voorbij', cls: 'bg-orange-50 text-orange-800 border-orange-300', stip: 'bg-orange-500' },
  { key: 'geannuleerd', label: 'Geannuleerd', cls: 'bg-red-50 text-red-700 border-red-200', stip: 'bg-red-500' },
  { key: 'gecrediteerd', label: 'Gecrediteerd', cls: 'bg-red-100 text-red-700 border-red-200', stip: 'bg-red-600' },
]
export const STATUS_INFO = Object.fromEntries(PLANNER_STATUSSEN.map((s) => [s.key, s])) as Record<PlannerStatus, (typeof PLANNER_STATUSSEN)[number]>

/** Statussen die nog werk vragen (tellen mee in "te versturen" en in het maandbedrag). */
export const OPEN_STATUSSEN: PlannerStatus[] = ['gepland', 'te_versturen', 'controle_vereist', 'achterstallig']

/**
 * De facturatiedatum mag ALTIJD aangepast worden — ook van een verstuurde of
 * betaalde factuur: een verkeerde datum moet je kunnen rechtzetten. Enkel een
 * geannuleerd moment verplaats je niet meer, want dat bestaat niet meer.
 */
export const magVerplaatsen = (status: PlannerStatus): boolean => status !== 'geannuleerd' && status !== 'gecrediteerd'

// ── Herkomst ─────────────────────────────────────────────────────────────────
export type Herkomst = 'eenmalig' | 'recurring' | 'contract' | 'wam'
export const HERKOMST_LABEL: Record<Herkomst, string> = {
  eenmalig: 'Eenmalige facturatie', recurring: 'Recurring facturatie', contract: 'Ondertekend contract', wam: 'Vesting (WAM)',
}

export type Bron = 'invoice' | 'recurring' | 'opdracht' | 'wam'

/** Eén gepland facturatiemoment, ongeacht waar het vandaan komt. */
export type Moment = {
  /** 'inv:<id>' | 'rec:<recurring_id>:<YYYY-MM>' | 'opd:<id>' | 'wam:<id>' */
  id: string
  bron: Bron
  bronId: string
  maand: string
  /** Facturatiedatum 'YYYY-MM-DD'. */
  datum: string
  client_id: string | null
  klant: string
  project: string | null
  omschrijving: string | null
  /** Bv. 'Maandfactuur', 'Eenmalig', 'Voorschot', 'WAM-termijn 3'. */
  type: string
  bedrag_excl: number
  btw_pct: number
  bedrag_incl: number
  status: PlannerStatus
  ruweStatus: string
  herkomst: Herkomst
  terugkerend: boolean
  verantwoordelijke: string | null
  volledig: boolean
  ontbrekend: string[]
  contract_id: string | null
  contract_titel: string | null
  recurring_id: string | null
  invoice_id: string | null
  wam_id: string | null
  schema: string | null
  opmerking: string | null
  acties: {
    bekijkenUrl: string | null
    aanpassenUrl: string | null
    voorbereidenUrl: string | null
    kanVerstuurd: boolean
    kanVerplaatsen: boolean
    kanAnnuleren: boolean
  }
}

// ── Datums (strings, UTC-rekenen — geen tijdzoneverschuiving) ───────────────
const parse = (d: string): number => { const [y, m, dd] = d.split('-').map(Number); return Date.UTC(y, m - 1, dd) }
const fmt = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
export const isDatum = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s)

export const plusDagen = (d: string, n: number): string => fmt(parse(d) + n * 86_400_000)
/** 0 = maandag … 6 = zondag. */
export const weekdag = (d: string): number => (new Date(parse(d)).getUTCDay() + 6) % 7
export const weekStart = (d: string): string => plusDagen(d, -weekdag(d))
export const weekEind = (d: string): string => plusDagen(weekStart(d), 6)
export const ymVan = (d: string): string => d.slice(0, 7)
export const maandStart = (ym: string): string => `${ym}-01`
export const maandEind = (ym: string): string => lastDayOfMonth(ym)
export const dagVan = (d: string): number => Number(d.slice(8, 10))
export { shiftYM }

/** Vandaag in de tijdzone van de app (Europe/Brussels), als 'YYYY-MM-DD'. */
export function vandaagBrussel(now: Date = new Date()): string {
  // en-CA geeft YYYY-MM-DD; de tijdzone bepaalt op welke dag we zitten.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

/** Zes weken (ma–zo) rond een maand, zoals een maandkalender ze toont. */
export function maandRooster(ym: string): string[][] {
  const start = weekStart(maandStart(ym))
  const weken: string[][] = []
  for (let w = 0; w < 6; w++) weken.push(Array.from({ length: 7 }, (_, i) => plusDagen(start, w * 7 + i)))
  return weken
}
export function roosterBereik(ym: string): { van: string; tot: string } {
  const r = maandRooster(ym)
  return { van: r[0][0], tot: r[5][6] }
}
export function weekBereik(d: string): { van: string; tot: string } { return { van: weekStart(d), tot: weekEind(d) } }

const MAANDEN = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']
export const DAGEN_KORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']
export const maandNaam = (ym: string): string => `${MAANDEN[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`
export const datumKort = (d: string): string => `${d.slice(8, 10)}/${d.slice(5, 7)}`
export const datumLang = (d: string): string => `${DAGEN_KORT[weekdag(d)]} ${Number(d.slice(8, 10))} ${MAANDEN[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`
export const datumNl = (d: string | null | undefined): string => (d && isDatum(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}` : '—')

export const euro = (n: number): string => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n)
export const euro2 = (n: number): string => new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

// ── Status bepalen (één regel voor alle bronnen) ────────────────────────────
export function bepaalStatus(p: { ruweStatus: string | null | undefined; datum: string; ontbrekend: string[]; vandaag: string }): PlannerStatus {
  const r = (p.ruweStatus ?? '').toLowerCase()
  if (r === 'geannuleerd') return 'geannuleerd'
  if (r === 'gecrediteerd') return 'gecrediteerd'
  if (r === 'betaald') return 'betaald'
  if (r === 'verstuurd' || r === 'gefactureerd' || r === 'afgehandeld') return 'verstuurd'
  if (r === 'controle_vereist' || p.ontbrekend.length > 0) return 'controle_vereist'
  if (p.datum < p.vandaag) return 'achterstallig'
  if (p.datum === p.vandaag) return 'te_versturen'
  return 'gepland'
}

/** Compacte weergave in een kalendercel: 'Verheyen Tegels – €680 – Maandfactuur'. */
export const kort = (m: Moment): string => `${m.klant} – ${euro(m.bedrag_excl)} – ${m.type}`

// ── Samenvatting (dashboardkaarten) ─────────────────────────────────────────
export type Samenvatting = {
  vandaag: number; week: number; maand: number
  maandBedrag: number; maandBedragTotaal: number
  achterstallig: number; ontbrekend: number
}
export type Categorie = 'vandaag' | 'week' | 'maand' | 'achterstallig' | 'ontbrekend'

export function inCategorie(m: Moment, cat: Categorie, vandaag: string): boolean {
  const open = OPEN_STATUSSEN.includes(m.status)
  switch (cat) {
    case 'vandaag': return open && m.datum === vandaag
    case 'week': return open && m.datum >= weekStart(vandaag) && m.datum <= weekEind(vandaag)
    case 'maand': return open && ymVan(m.datum) === ymVan(vandaag)
    case 'achterstallig': return m.status === 'achterstallig'
    case 'ontbrekend': return m.status === 'controle_vereist'
  }
}

export function samenvatting(momenten: Moment[], vandaag: string): Samenvatting {
  const ym = ymVan(vandaag)
  const maandAlle = momenten.filter((m) => ymVan(m.datum) === ym && m.status !== 'geannuleerd' && m.status !== 'gecrediteerd')
  return {
    vandaag: momenten.filter((m) => inCategorie(m, 'vandaag', vandaag)).length,
    week: momenten.filter((m) => inCategorie(m, 'week', vandaag)).length,
    maand: momenten.filter((m) => inCategorie(m, 'maand', vandaag)).length,
    maandBedrag: maandAlle.filter((m) => OPEN_STATUSSEN.includes(m.status)).reduce((s, m) => s + m.bedrag_excl, 0),
    maandBedragTotaal: maandAlle.reduce((s, m) => s + m.bedrag_excl, 0),
    achterstallig: momenten.filter((m) => m.status === 'achterstallig').length,
    ontbrekend: momenten.filter((m) => m.status === 'controle_vereist').length,
  }
}

// ── Filters ─────────────────────────────────────────────────────────────────
export type Filters = {
  categorie: Categorie | null
  van: string; tot: string
  klant: string; project: string; status: PlannerStatus | ''; type: string
  terugkerend: '' | 'eenmalig' | 'terugkerend'
  verantwoordelijke: string
  volledig: '' | 'volledig' | 'ontbrekend'
  toonGeannuleerd: boolean
}
export const LEEG_FILTERS: Filters = { categorie: null, van: '', tot: '', klant: '', project: '', status: '', type: '', terugkerend: '', verantwoordelijke: '', volledig: '', toonGeannuleerd: false }
export const filtersActief = (f: Filters): boolean => JSON.stringify({ ...f, van: '', tot: '' }) !== JSON.stringify(LEEG_FILTERS) || !!f.van || !!f.tot

export function pasFiltersToe(momenten: Moment[], f: Filters, vandaag: string): Moment[] {
  return momenten.filter((m) => {
    if ((m.status === 'geannuleerd' || m.status === 'gecrediteerd') && !f.toonGeannuleerd && f.status !== m.status) return false
    if (f.categorie && !inCategorie(m, f.categorie, vandaag)) return false
    if (f.van && m.datum < f.van) return false
    if (f.tot && m.datum > f.tot) return false
    if (f.klant && m.client_id !== f.klant) return false
    if (f.project && !`${m.project ?? ''} ${m.contract_titel ?? ''} ${m.omschrijving ?? ''}`.toLowerCase().includes(f.project.toLowerCase())) return false
    if (f.status && m.status !== f.status) return false
    if (f.type && m.type !== f.type) return false
    if (f.terugkerend === 'terugkerend' && !m.terugkerend) return false
    if (f.terugkerend === 'eenmalig' && m.terugkerend) return false
    if (f.verantwoordelijke && (m.verantwoordelijke ?? '') !== f.verantwoordelijke) return false
    if (f.volledig === 'volledig' && !m.volledig) return false
    if (f.volledig === 'ontbrekend' && m.volledig) return false
    return true
  })
}

/** Aantal en bedrag (excl.) per dag — voor de kalendercellen. Geannuleerd telt niet mee. */
export function dagTotalen(momenten: Moment[]): Map<string, { aantal: number; bedrag: number }> {
  const uit = new Map<string, { aantal: number; bedrag: number }>()
  for (const m of momenten) {
    if (m.status === 'geannuleerd' || m.status === 'gecrediteerd') continue
    const t = uit.get(m.datum) ?? { aantal: 0, bedrag: 0 }
    t.aantal++; t.bedrag += m.bedrag_excl
    uit.set(m.datum, t)
  }
  return uit
}

export type Sortering = { veld: 'datum' | 'klant' | 'bedrag' | 'status'; richting: 'asc' | 'desc' }
const STATUS_VOLGORDE: PlannerStatus[] = ['achterstallig', 'te_versturen', 'controle_vereist', 'gepland', 'verstuurd', 'betaald', 'geannuleerd', 'gecrediteerd']
export function sorteer(momenten: Moment[], s: Sortering): Moment[] {
  const r = s.richting === 'asc' ? 1 : -1
  return [...momenten].sort((a, b) => {
    let v = 0
    if (s.veld === 'datum') v = a.datum.localeCompare(b.datum) || a.klant.localeCompare(b.klant)
    else if (s.veld === 'klant') v = a.klant.localeCompare(b.klant, 'nl') || a.datum.localeCompare(b.datum)
    else if (s.veld === 'bedrag') v = a.bedrag_excl - b.bedrag_excl || a.datum.localeCompare(b.datum)
    else v = STATUS_VOLGORDE.indexOf(a.status) - STATUS_VOLGORDE.indexOf(b.status) || a.datum.localeCompare(b.datum)
    return v * r
  })
}

/** Unieke sleutel per moment: dezelfde bron + dezelfde datum kan maar één keer bestaan. */
export const momentSleutel = (bron: Bron, bronId: string, maand?: string): string =>
  bron === 'recurring' ? `rec:${bronId}:${maand}` : bron === 'invoice' ? `inv:${bronId}` : bron === 'opdracht' ? `opd:${bronId}` : `wam:${bronId}`

export function ontleedSleutel(id: string): { bron: Bron; bronId: string; maand: string | null } | null {
  const [p, a, b] = id.split(':')
  if (p === 'inv' && a) return { bron: 'invoice', bronId: a, maand: null }
  if (p === 'rec' && a && b) return { bron: 'recurring', bronId: a, maand: b }
  if (p === 'opd' && a) return { bron: 'opdracht', bronId: a, maand: null }
  if (p === 'wam' && a) return { bron: 'wam', bronId: a, maand: null }
  return null
}
