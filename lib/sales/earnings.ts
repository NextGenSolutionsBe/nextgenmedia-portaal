/**
 * Rekenkern voor de verdiensten van een appointment setter.
 *
 * Pure module: geen database, geen server-only imports. Zo draait dezelfde
 * berekening op de server én live in de teller op het scherm, en kan ze apart
 * getest worden. Bij geld is dat geen luxe — een teller die iets anders
 * optelt dan de uitbetaling is erger dan geen teller.
 *
 * ALLES IN CENTEN, als geheel getal. Bedragen in gewone kommagetallen lopen
 * bij optellen millimeter voor millimeter uit de pas; bij een uurloon dat per
 * seconde aantikt, merk je dat.
 */

export type Interval = { started_at: string; ended_at: string | null }

/** Gewerkte seconden in één blok. Een lopende timer telt tot `now`. */
export function secondsOf(entry: Interval, now = Date.now()): number {
  const start = new Date(entry.started_at).getTime()
  if (!Number.isFinite(start)) return 0
  const end = entry.ended_at ? new Date(entry.ended_at).getTime() : now
  if (!Number.isFinite(end) || end <= start) return 0
  return Math.floor((end - start) / 1000)
}

/** Totaal aantal gewerkte seconden. */
export function totalSeconds(entries: Interval[], now = Date.now()): number {
  return entries.reduce((sum, e) => sum + secondsOf(e, now), 0)
}

/**
 * Verdiend bedrag in centen, naar beneden afgerond op hele centen.
 *
 * Naar BENEDEN, bewust: dan kan de teller op het scherm nooit meer beloven dan
 * wat er effectief uitbetaald wordt.
 */
export function earnedCents(seconds: number, hourlyRateCents: number): number {
  if (seconds <= 0 || hourlyRateCents <= 0) return 0
  return Math.floor((seconds * hourlyRateCents) / 3600)
}

/**
 * Commissie op de waarde van het eerste contract, naar beneden afgerond.
 * `pct` is een percentage (7 = 7 %).
 */
export function commissionCents(dealValueCents: number, pct: number): number {
  if (dealValueCents <= 0 || pct <= 0) return 0
  return Math.floor((dealValueCents * pct) / 100)
}

/** € 1.234,56 — Belgisch, met vaste twee cijfers. */
export function euro(cents: number): string {
  return new Intl.NumberFormat('nl-BE', { style: 'currency', currency: 'EUR' }).format(cents / 100)
}

/**
 * Het bedrag voor de meelopende teller, met vijf cijfers na de komma.
 *
 * Hier rekenen we bewust NIET met afgeronde centen maar met de exacte waarde,
 * anders staat de teller stil tussen twee centen door. Wat uitbetaald wordt
 * blijft earnedCents(); dit is enkel wat je ziet bewegen.
 */
export function liveEuro(seconds: number, hourlyRateCents: number): string {
  const exact = (seconds * hourlyRateCents) / 3600 / 100
  return `€ ${exact.toFixed(5).replace('.', ',')}`
}

/** "3 u 24 min" — leesbaar, zonder seconden waar die niets toevoegen. */
export function hoursText(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h === 0 && m === 0) return `${seconds} sec`
  if (h === 0) return `${m} min`
  return `${h} u ${String(m).padStart(2, '0')} min`
}

/** "02:14:07" — voor de lopende timer. */
export function clockText(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}

/** Eerste dag van de maand van deze datum, als YYYY-MM-DD. */
export function monthKey(d: Date | string): string {
  const x = typeof d === 'string' ? new Date(d) : d
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-01`
}

/** "augustus 2026" */
export function monthLabel(key: string): string {
  const d = new Date(key)
  return d.toLocaleDateString('nl-BE', { month: 'long', year: 'numeric' })
}

/** Standaard btw-tarief in België. */
export const VAT_PCT = 21

/**
 * Bedrag inclusief btw, in centen.
 *
 * De tarieven van een setter (€ 50/u, 7 % commissie) zijn EXCLUSIEF btw. Wat
 * hij effectief moet factureren hangt van zijn statuut af — een vrijgestelde
 * kleine onderneming rekent geen btw — dus het percentage staat apart en is
 * aanpasbaar in plaats van vastgeklonken.
 */
export function withVat(cents: number, pct = VAT_PCT): number {
  if (cents <= 0) return 0
  return Math.round(cents * (1 + pct / 100))
}

// ── Tijdsbelasting en ROI (uit de Cold Caller ROI Tracker) ──────────────────

/**
 * Hoeveel werk vraagt een gewonnen deal in de uitvoering?
 *
 * Een contract van €3.000 dat vijf keer zoveel uren kost als een ander van
 * €3.000 is niet evenveel waard. Daarom weegt de projectwaarde met een factor
 * naar de tijdsbelasting: zeer laag telt volledig, zeer hoog nog voor 40%.
 * De factoren komen letterlijk uit het rekenblad dat hiervoor gebruikt werd.
 */
export const TIJDSBELASTING: { waarde: 1 | 2 | 3 | 4 | 5; label: string; factor: number }[] = [
  { waarde: 1, label: 'Zeer laag', factor: 1 },
  { waarde: 2, label: 'Laag', factor: 0.9 },
  { waarde: 3, label: 'Gemiddeld', factor: 0.75 },
  { waarde: 4, label: 'Hoog', factor: 0.6 },
  { waarde: 5, label: 'Zeer hoog', factor: 0.4 },
]

/** Factor bij een tijdsbelasting; onbekend of leeg telt volledig mee. */
export function tijdsbelastingFactor(waarde: number | null | undefined): number {
  return TIJDSBELASTING.find((t) => t.waarde === waarde)?.factor ?? 1
}

/** Projectwaarde na tijdsbelasting, in centen, naar beneden afgerond. */
export function gewogenWaardeCents(dealValueCents: number, tijdsbelasting: number | null | undefined): number {
  if (dealValueCents <= 0) return 0
  return Math.floor(dealValueCents * tijdsbelastingFactor(tijdsbelasting))
}

/**
 * Rendement op de setter: (gewogen omzet − kost) / kost.
 * `null` zolang er geen kost is — dan valt er niets te delen.
 */
export function roi(gewogenCents: number, kostCents: number): number | null {
  if (kostCents <= 0) return null
  return (gewogenCents - kostCents) / kostCents
}

/** "167%" of "−23%". */
export function roiText(r: number | null): string {
  if (r === null) return '—'
  return `${Math.round(r * 100).toLocaleString('nl-BE')}%`
}
