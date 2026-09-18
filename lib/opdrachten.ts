// Opdrachten — pure module, ook bruikbaar in clientcomponenten.
//
// Een opdracht is werk dat binnenkomt en opgevolgd moet worden, van de eerste
// vraag om een projectvoorstel tot de factuur die de deur uit is. De status
// volgt die weg: voorstel → interesse → contract → uitvoering → facturatie.
// Hangt er een contract of factuur aan de opdracht, dan schuift de status
// vanzelf mee (contract getekend → "Getekend", factuur verstuurd → "Factuur
// verstuurd") — zie afgeleideStatus() en magAutomatischNaar().

export type Fase = 'aanvraag' | 'voorstel' | 'contract' | 'uitvoering' | 'facturatie' | 'afgesloten'

export const FASEN: { key: Fase; label: string; kleur: string }[] = [
  { key: 'aanvraag',   label: 'Aanvraag',      kleur: 'bg-gray-100 text-gray-700 border-gray-200' },
  { key: 'voorstel',   label: 'Projectvoorstel', kleur: 'bg-purple-50 text-purple-700 border-purple-200' },
  { key: 'contract',   label: 'Contract',      kleur: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'uitvoering', label: 'Uitvoering',    kleur: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'facturatie', label: 'Facturatie',    kleur: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { key: 'afgesloten', label: 'Afgesloten',    kleur: 'bg-gray-50 text-gray-500 border-gray-200' },
]

export type OpdrachtStatus =
  | 'open'
  | 'voorstel_gevraagd' | 'voorstel_bezig' | 'voorstel_klaar' | 'voorstel_voorgelegd' | 'interesse' | 'geen_interesse'
  | 'contract_verstuurd' | 'getekend'
  | 'bezig' | 'wacht' | 'opgeleverd'
  | 'te_factureren' | 'factuur_verstuurd' | 'betaald'
  | 'afgerond' | 'geannuleerd'

export type StatusInfo = {
  key: OpdrachtStatus
  label: string
  /** Korte uitleg in de UI, zodat iedereen dezelfde status hetzelfde gebruikt. */
  hint: string
  fase: Fase
  badge: string
  /** Telt deze status mee als "nog te doen"? */
  openstaand: boolean
  /** Eindpunt: hier schuift een opdracht niet meer automatisch vandaan. */
  eind: boolean
}

/**
 * De volgorde van deze lijst IS de volgorde van de flow. "Nieuw" staat vooraan
 * (ook voor los werk zoals een shoot); "Geen interesse" en "Geannuleerd" zijn
 * zijsporen die je enkel met de hand kiest.
 */
export const STATUSSEN: StatusInfo[] = [
  { key: 'open', label: 'Nieuw', fase: 'aanvraag', openstaand: true, eind: false,
    hint: 'Binnengekomen, nog niets mee gedaan. Ook voor los werk zoals een shoot of materiaal dat je nodig hebt.',
    badge: 'bg-gray-100 text-gray-700 border-gray-200' },
  { key: 'voorstel_gevraagd', label: 'Projectvoorstel gevraagd', fase: 'voorstel', openstaand: true, eind: false,
    hint: 'De klant of prospect wil een projectvoorstel; er is nog niets opgemaakt.',
    badge: 'bg-purple-50 text-purple-700 border-purple-200' },
  { key: 'voorstel_bezig', label: 'Projectvoorstel in opmaak', fase: 'voorstel', openstaand: true, eind: false,
    hint: 'We schrijven aan het voorstel.',
    badge: 'bg-purple-50 text-purple-700 border-purple-200' },
  { key: 'voorstel_klaar', label: 'Projectvoorstel klaar', fase: 'voorstel', openstaand: true, eind: false,
    hint: 'Het voorstel is af, maar nog niet aan de klant voorgelegd.',
    badge: 'bg-purple-100 text-purple-800 border-purple-200' },
  { key: 'voorstel_voorgelegd', label: 'Projectvoorstel voorgelegd', fase: 'voorstel', openstaand: true, eind: false,
    hint: 'Voorgelegd of verstuurd — we wachten op een reactie van de klant.',
    badge: 'bg-purple-100 text-purple-800 border-purple-200' },
  { key: 'interesse', label: 'Interesse', fase: 'voorstel', openstaand: true, eind: false,
    hint: 'De klant wil verder na het voorstel; volgende stap is het contract.',
    badge: 'bg-lime-50 text-lime-800 border-lime-200' },
  { key: 'geen_interesse', label: 'Geen interesse', fase: 'voorstel', openstaand: false, eind: true,
    hint: 'De klant gaat niet verder na het voorstel.',
    badge: 'bg-gray-50 text-gray-400 border-gray-200 line-through' },
  { key: 'contract_verstuurd', label: 'Contract verstuurd', fase: 'contract', openstaand: true, eind: false,
    hint: 'De tekenlink is verstuurd; we wachten op de handtekening. Volgt automatisch uit een gekoppeld contract.',
    badge: 'bg-blue-50 text-blue-700 border-blue-200' },
  { key: 'getekend', label: 'Getekend', fase: 'contract', openstaand: true, eind: false,
    hint: 'Contract ondertekend — het werk kan starten. Volgt automatisch uit een gekoppeld contract.',
    badge: 'bg-blue-100 text-blue-800 border-blue-200' },
  { key: 'bezig', label: 'In uitvoering', fase: 'uitvoering', openstaand: true, eind: false,
    hint: 'We zijn ermee bezig.',
    badge: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'wacht', label: 'Wacht op klant', fase: 'uitvoering', openstaand: true, eind: false,
    hint: 'Bal ligt bij de klant — materiaal, feedback, goedkeuring, …',
    badge: 'bg-amber-100 text-amber-900 border-amber-200' },
  { key: 'opgeleverd', label: 'Opgeleverd', fase: 'uitvoering', openstaand: true, eind: false,
    hint: 'Het werk is geleverd; nu nog factureren.',
    badge: 'bg-amber-50 text-amber-800 border-amber-200' },
  { key: 'te_factureren', label: 'Te factureren', fase: 'facturatie', openstaand: true, eind: false,
    hint: 'Er moet een factuur gemaakt worden. Volgt automatisch uit een openstaande facturatieopdracht van het contract.',
    badge: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  { key: 'factuur_verstuurd', label: 'Factuur verstuurd', fase: 'facturatie', openstaand: true, eind: false,
    hint: 'De factuur is verstuurd; we wachten op betaling. Volgt automatisch uit een gekoppelde factuur.',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  { key: 'betaald', label: 'Betaald', fase: 'facturatie', openstaand: false, eind: true,
    hint: 'Factuur betaald — de opdracht is financieel rond.',
    badge: 'bg-green-100 text-green-800 border-green-200' },
  { key: 'afgerond', label: 'Afgerond', fase: 'afgesloten', openstaand: false, eind: true,
    hint: 'Klaar.',
    badge: 'bg-green-50 text-green-700 border-green-200' },
  { key: 'geannuleerd', label: 'Geannuleerd', fase: 'afgesloten', openstaand: false, eind: true,
    hint: 'Gaat niet door.',
    badge: 'bg-gray-50 text-gray-400 border-gray-200 line-through' },
]

export const statusInfo = (key: string | null | undefined): StatusInfo =>
  STATUSSEN.find((s) => s.key === key) ?? STATUSSEN[0]

export const isStatus = (v: unknown): v is OpdrachtStatus => STATUSSEN.some((s) => s.key === v)

/** Statussen die nog aandacht vragen. */
export const OPEN_STATUSSEN: OpdrachtStatus[] = STATUSSEN.filter((s) => s.openstaand).map((s) => s.key)

/** Plaats in de flow (0 = begin). Zijsporen tellen als hun plek in de lijst. */
export const volgorde = (key: string | null | undefined): number => {
  const i = STATUSSEN.findIndex((s) => s.key === key)
  return i < 0 ? 0 : i
}

export const faseInfo = (fase: Fase) => FASEN.find((f) => f.key === fase) ?? FASEN[0]

/** Statussen per fase, voor keuzelijsten en filters. */
export const statussenPerFase = (fase: Fase): StatusInfo[] => STATUSSEN.filter((s) => s.fase === fase)

/**
 * De logische volgende stap in de flow — voor de knop "Volgende stap".
 * Zijsporen (geen interesse, geannuleerd) worden overgeslagen; vanaf een
 * eindpunt is er geen volgende stap.
 */
export function volgendeStatus(huidig: OpdrachtStatus): OpdrachtStatus | null {
  const info = statusInfo(huidig)
  if (info.eind) return null
  for (let i = volgorde(huidig) + 1; i < STATUSSEN.length; i++) {
    const s = STATUSSEN[i]
    if (s.key === 'geen_interesse' || s.key === 'geannuleerd') continue
    return s.key
  }
  return null
}

// ── Koppelingen: wat contract en factuur over de status zeggen ───────────────

export type ContractKoppeling = {
  id: string
  title: string | null
  /** Canonieke contractstatus (lib/contract-status): verzonden, getekend, … */
  status: string
  label?: string
}

export type FactuurKoppeling = {
  id: string
  /** Ruwe factuurstatus: te_versturen | verstuurd | gefactureerd | betaald | geannuleerd */
  status: string
  invoice_date: string | null
  amount_incl: number | null
  amount_excl?: number | null
  description: string | null
}

export type Koppelingen = {
  contract: ContractKoppeling | null
  facturen: FactuurKoppeling[]
  /** Staat er een facturatieopdracht van het contract open waarvan de datum al bereikt is? */
  facturatieOpen: boolean
}

/**
 * Welke status volgt uit de gekoppelde gegevens? Null als er niets aan te
 * lezen valt (geen koppeling, of contract nog niet verstuurd).
 *
 * De verst gevorderde aanwijzing wint: een getekend contract met een
 * verstuurde factuur is "Factuur verstuurd", niet "Getekend".
 */
export function afgeleideStatus(k: Koppelingen | null | undefined): OpdrachtStatus | null {
  if (!k) return null
  const kandidaten: OpdrachtStatus[] = []
  const c = k.contract?.status
  if (c === 'verzonden' || c === 'geopend' || c === 'ingevuld') kandidaten.push('contract_verstuurd')
  if (c === 'getekend') kandidaten.push('getekend')
  if (c === 'getekend' && k.facturatieOpen) kandidaten.push('te_factureren')

  const facturen = (k.facturen ?? []).filter((f) => f.status !== 'geannuleerd')
  const verstuurd = facturen.filter((f) => f.status === 'verstuurd' || f.status === 'gefactureerd' || f.status === 'betaald')
  if (facturen.length > 0 && verstuurd.length === 0) kandidaten.push('te_factureren')
  if (verstuurd.length > 0) kandidaten.push('factuur_verstuurd')
  if (facturen.length > 0 && facturen.every((f) => f.status === 'betaald')) kandidaten.push('betaald')

  if (kandidaten.length === 0) return null
  return kandidaten.reduce((a, b) => (volgorde(b) > volgorde(a) ? b : a))
}

/**
 * Mag de status automatisch naar `afgeleid` schuiven?
 *
 * Enkel VOORUIT, en nooit weg van een eindpunt (afgerond, geannuleerd, geen
 * interesse, betaald): wie een opdracht bewust afsloot, wil niet dat een
 * late factuur hem heropent. `alToegepast` is de afgeleide status die eerder
 * al werd doorgevoerd (of door de gebruiker bewust werd overschreven) — die
 * passen we niet nog eens toe, anders zou een handmatige correctie meteen
 * weer ongedaan gemaakt worden.
 */
export function magAutomatischNaar(
  huidig: OpdrachtStatus, afgeleid: OpdrachtStatus | null, alToegepast?: string | null,
): boolean {
  if (!afgeleid) return false
  if (afgeleid === alToegepast) return false
  if (statusInfo(huidig).eind) return false
  return volgorde(afgeleid) > volgorde(huidig)
}

export type Opdracht = {
  id: string
  client_id: string | null
  klant_vrij: string | null
  titel: string
  omschrijving: string | null
  status: OpdrachtStatus
  deadline: string | null
  wie: string | null
  afgerond_op: string | null
  created_at: string
  contract_id?: string | null
  invoice_id?: string | null
  lead_id?: string | null
  status_bron?: string | null
  status_gewijzigd_op?: string | null
  /** Waarde van de opdracht, excl. btw (handmatig ingevuld). */
  bedrag_excl?: number | null
  /** Meegeleverd door de API, niet in de tabel. */
  klant_naam?: string | null
  contract?: ContractKoppeling | null
  facturen?: FactuurKoppeling[]
  /** Wat contract/factuur zeggen — ter info, ook als de status handmatig anders staat. */
  afgeleid?: OpdrachtStatus | null
  /** De waarde die telt in het verslag (zie waardeVan). */
  waarde?: number | null
  waarde_bron?: 'opdracht' | 'facturen' | null
}

// ── Waarde en verslag ────────────────────────────────────────────────────────

/**
 * Wat is deze opdracht waard? Het ingevulde bedrag wint; zonder bedrag maar
 * mét gekoppelde facturen telt de som van die facturen (excl. btw, zonder de
 * geannuleerde). Zo staat een opdracht die al gefactureerd is nooit op nul.
 */
export function waardeVan(o: Pick<Opdracht, 'bedrag_excl' | 'facturen'>): { waarde: number | null; bron: 'opdracht' | 'facturen' | null } {
  const b = Number(o.bedrag_excl)
  if (o.bedrag_excl !== null && o.bedrag_excl !== undefined && Number.isFinite(b) && b >= 0) return { waarde: Math.round(b * 100) / 100, bron: 'opdracht' }
  const facturen = (o.facturen ?? []).filter((f) => f.status !== 'geannuleerd' && f.amount_excl !== null && f.amount_excl !== undefined)
  if (facturen.length === 0) return { waarde: null, bron: null }
  const som = facturen.reduce((t, f) => t + (Number(f.amount_excl) || 0), 0)
  return { waarde: Math.round(som * 100) / 100, bron: 'facturen' }
}

export type VerslagRegel = { aantal: number; waarde: number; zonderWaarde: number }
export type Verslag = {
  /** Alles wat nog openstaat (alle open statussen samen). */
  open: VerslagRegel
  /** Open werk per fase — de voorstelfase zonder "geen interesse". */
  voorstel: VerslagRegel
  contract: VerslagRegel
  uitvoering: VerslagRegel
  /** Te factureren + factuur verstuurd: geld dat onderweg is. */
  facturatie: VerslagRegel
  betaald: VerslagRegel
  /** Geen interesse + geannuleerd. */
  verloren: VerslagRegel
  teLaat: VerslagRegel
}

const leeg = (): VerslagRegel => ({ aantal: 0, waarde: 0, zonderWaarde: 0 })
const tel = (r: VerslagRegel, w: number | null) => { r.aantal++; if (w === null) r.zonderWaarde++; else r.waarde = Math.round((r.waarde + w) * 100) / 100 }

/** Het verslag bovenaan de pagina: aantallen en waarde per stuk van de flow. */
export function verslag(rijen: Pick<Opdracht, 'status' | 'deadline' | 'bedrag_excl' | 'facturen' | 'waarde'>[], nu: Date = new Date()): Verslag {
  const v: Verslag = { open: leeg(), voorstel: leeg(), contract: leeg(), uitvoering: leeg(), facturatie: leeg(), betaald: leeg(), verloren: leeg(), teLaat: leeg() }
  for (const o of rijen) {
    const info = statusInfo(o.status)
    const w = o.waarde !== undefined ? o.waarde : waardeVan(o).waarde
    if (info.openstaand) tel(v.open, w)
    if (info.openstaand && info.fase === 'voorstel') tel(v.voorstel, w)
    if (info.openstaand && info.fase === 'aanvraag') tel(v.voorstel, w)
    if (info.fase === 'contract') tel(v.contract, w)
    if (info.fase === 'uitvoering') tel(v.uitvoering, w)
    if (o.status === 'te_factureren' || o.status === 'factuur_verstuurd') tel(v.facturatie, w)
    if (o.status === 'betaald') tel(v.betaald, w)
    if (o.status === 'geen_interesse' || o.status === 'geannuleerd') tel(v.verloren, w)
    if (isTeLaat(o, nu)) tel(v.teLaat, w)
  }
  return v
}

/** Vandaag in Brussel als YYYY-MM-DD — een deadline is een DAG, geen moment. */
export function vandaagISO(nu: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Brussels', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(nu)
}

/**
 * Te laat? Alleen open werk met een deadline die vóór vandaag ligt.
 *
 * Vandaag zelf telt bewust NIET als te laat: je hebt de hele dag nog. Wie
 * "vandaag" apart wil zien, gebruikt isVandaag().
 */
export function isTeLaat(o: Pick<Opdracht, 'status' | 'deadline'>, nu: Date = new Date()): boolean {
  if (!o.deadline) return false
  if (!OPEN_STATUSSEN.includes(o.status)) return false
  return o.deadline < vandaagISO(nu)
}

export function isVandaag(o: Pick<Opdracht, 'status' | 'deadline'>, nu: Date = new Date()): boolean {
  if (!o.deadline) return false
  if (!OPEN_STATUSSEN.includes(o.status)) return false
  return o.deadline === vandaagISO(nu)
}

/** "3 dagen te laat", "vandaag", "over 5 dagen" — in gewone taal. */
export function deadlineTekst(deadline: string | null, nu: Date = new Date()): string | null {
  if (!deadline) return null
  const vandaag = vandaagISO(nu)
  if (deadline === vandaag) return 'vandaag'
  // Dagen tellen via UTC-middag: zo kan zomertijd de uitkomst niet verschuiven.
  const d = (s: string) => Date.parse(`${s}T12:00:00Z`)
  const dagen = Math.round((d(deadline) - d(vandaag)) / 86400000)
  if (dagen === 1) return 'morgen'
  if (dagen === -1) return '1 dag te laat'
  if (dagen < 0) return `${Math.abs(dagen)} dagen te laat`
  return `over ${dagen} dagen`
}

/**
 * Sorteervolgorde van de lijst: eerst wat aandacht vraagt.
 * Open werk boven afgerond, daarbinnen op deadline (zonder deadline achteraan),
 * en gelijke gevallen op aanmaakdatum zodat de volgorde niet zomaar wisselt.
 */
export function sorteer(a: Opdracht, b: Opdracht): number {
  const openA = OPEN_STATUSSEN.includes(a.status) ? 0 : 1
  const openB = OPEN_STATUSSEN.includes(b.status) ? 0 : 1
  if (openA !== openB) return openA - openB
  if (a.deadline !== b.deadline) {
    if (!a.deadline) return 1
    if (!b.deadline) return -1
    return a.deadline < b.deadline ? -1 : 1
  }
  return (b.created_at ?? '').localeCompare(a.created_at ?? '')
}

export type StatusFilter = { fase?: Fase | 'alle' | 'open' | null; status?: OpdrachtStatus | '' | null; toonAfgesloten?: boolean }

/**
 * Filter voor de lijst. Een gekozen status wint altijd (ook als die
 * afgesloten is); anders de fase; anders "alles wat openstaat", eventueel
 * aangevuld met de afgesloten opdrachten.
 */
export function pastInFilter(o: Pick<Opdracht, 'status'>, f: StatusFilter): boolean {
  const info = statusInfo(o.status)
  if (f.status) return o.status === f.status
  if (f.fase && f.fase !== 'alle' && f.fase !== 'open') return info.fase === f.fase
  if (f.fase === 'alle') return true
  return info.openstaand || !!f.toonAfgesloten
}
