// Beschikbaarheid voor de Verkoop-kalender (§5, §11).
//
// HET PRINCIPE, in één regel:
//   boekbaar (WIT) = werkuren − bezet − buffers − bestaande afspraken
//   niet boekbaar (GRIJS) = het complement daarvan
//
// De kalender rendert het grijs als complement van precies deze lijst, en legt
// de sleep-capture ALLEEN over de witte segmenten. Zo kunnen beeld ("grijs") en
// gedrag ("niet sleepbaar") nooit uit elkaar lopen: het is dezelfde berekening.
//
// Pure module (geen server-only imports): dezelfde functie draait op de server
// bij het hervalideren van een boeking én in de browser bij het tekenen.
// Alles rekent in UTC-milliseconden; tijdzones komen alleen kijken bij het
// omzetten van werkuren (lokale kloktijden) naar echte momenten.

export type Interval = { start: number; end: number }   // UTC ms, [start, end)

export type WorkRule = { weekday: number; start_time: string; end_time: string } // 0 = maandag
export type WorkException = { date: string; closed: boolean; start_time?: string | null; end_time?: string | null }

export type BookingRules = {
  bufferBeforeMin: number
  bufferAfterMin: number
  minNoticeMin: number
  maxHorizonDays: number
  slotIntervalMin: number
}

// ── Tijdzone-hulp ────────────────────────────────────────────────────────────
// We gebruiken Intl i.p.v. een datumbibliotheek: dat scheelt een dependency en
// Intl kent de zomertijdregels van de ingestelde zone.

/** Verschil tussen lokale tijd in `tz` en UTC, op een gegeven moment (ms). */
function tzOffsetMs(utcMs: number, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
  const parts = dtf.formatToParts(new Date(utcMs))
  const m: Record<string, string> = {}
  for (const p of parts) m[p.type] = p.value
  // 'hour' kan 24 zijn bij middernacht in sommige omgevingen.
  const hour = Number(m.hour) % 24
  const asIfUtc = Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), hour, Number(m.minute), Number(m.second))
  return asIfUtc - utcMs
}

/** Lokale wandkloktijd in `tz` → echt moment (UTC ms). Houdt rekening met DST. */
export function zonedToUtc(y: number, mo: number, d: number, hh: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, hh, mi)
  const off1 = tzOffsetMs(guess, tz)
  let utc = guess - off1
  // Bij een DST-overgang kan de offset op het nieuwe moment anders zijn.
  const off2 = tzOffsetMs(utc, tz)
  if (off2 !== off1) utc = guess - off2
  return utc
}

/** Kalenderdatum + weekdag (0 = maandag) zoals die in `tz` gezien wordt. */
export function zonedParts(utcMs: number, tz: string): { y: number; mo: number; d: number; weekday: number; iso: string } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  })
  const m: Record<string, string> = {}
  for (const p of dtf.formatToParts(new Date(utcMs))) m[p.type] = p.value
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const weekday = Math.max(0, names.indexOf(m.weekday))
  const y = Number(m.year), mo = Number(m.month), d = Number(m.day)
  return { y, mo, d, weekday, iso: `${m.year}-${m.month}-${m.day}` }
}

const parseHm = (t: string): [number, number] => {
  const [h, m] = t.split(':')
  return [Number(h) || 0, Number(m) || 0]
}

// ── Intervalrekenen ──────────────────────────────────────────────────────────

/** Overlappende/aansluitende stukken samenvoegen en op tijd sorteren. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const valid = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start)
  const out: Interval[] = []
  for (const cur of valid) {
    const last = out[out.length - 1]
    if (last && cur.start <= last.end) last.end = Math.max(last.end, cur.end)
    else out.push({ ...cur })
  }
  return out
}

/** `base` min `cuts` — wat blijft er over. Dit is de kern van wit vs. grijs. */
export function subtractIntervals(base: Interval[], cuts: Interval[]): Interval[] {
  const holes = mergeIntervals(cuts)
  let result = mergeIntervals(base)
  for (const hole of holes) {
    const next: Interval[] = []
    for (const seg of result) {
      if (hole.end <= seg.start || hole.start >= seg.end) { next.push(seg); continue }  // raakt elkaar niet
      if (hole.start > seg.start) next.push({ start: seg.start, end: hole.start })      // stuk vóór het gat
      if (hole.end < seg.end) next.push({ start: hole.end, end: seg.end })              // stuk ná het gat
    }
    result = next
  }
  return result.filter((i) => i.end > i.start)
}

/** Het complement van `inside` binnen [from, to] — precies wat grijs wordt. */
export function complement(inside: Interval[], from: number, to: number): Interval[] {
  return subtractIntervals([{ start: from, end: to }], inside)
}

// ── Werkuren voor een periode ────────────────────────────────────────────────

/**
 * Zet de werkuren-regels om naar echte momenten binnen [from, to].
 * Een uitzondering voor een dag VERVANGT de gewone regels van die dag: 'closed'
 * maakt de dag volledig grijs, anders gelden de afwijkende uren.
 */
export function workingIntervals(
  rules: WorkRule[],
  exceptions: WorkException[],
  from: number,
  to: number,
  tz: string,
): Interval[] {
  const byDate = new Map(exceptions.map((e) => [e.date.slice(0, 10), e]))
  const out: Interval[] = []

  // Een dag extra aan beide kanten: een werkblok kan over de rand van het
  // gevraagde venster heen lopen (en wordt daarna netjes afgeknipt).
  const DAY = 86400000
  for (let cursor = from - DAY; cursor <= to + DAY; cursor += DAY) {
    const { y, mo, d, weekday, iso } = zonedParts(cursor, tz)
    const exc = byDate.get(iso)

    if (exc) {
      if (exc.closed || !exc.start_time || !exc.end_time) continue   // dag dicht
      const [sh, sm] = parseHm(exc.start_time)
      const [eh, em] = parseHm(exc.end_time)
      out.push({ start: zonedToUtc(y, mo, d, sh, sm, tz), end: zonedToUtc(y, mo, d, eh, em, tz) })
      continue
    }

    for (const r of rules) {
      if (r.weekday !== weekday) continue
      const [sh, sm] = parseHm(r.start_time)
      const [eh, em] = parseHm(r.end_time)
      out.push({ start: zonedToUtc(y, mo, d, sh, sm, tz), end: zonedToUtc(y, mo, d, eh, em, tz) })
    }
  }

  // Afknippen op het gevraagde venster en dubbele blokken samenvoegen.
  return subtractIntervals(mergeIntervals(out), complement([{ start: from, end: to }], -8.64e15, 8.64e15))
    .filter((i) => i.end > i.start)
}

// ── De centrale berekening ───────────────────────────────────────────────────

export type BookableInput = {
  from: number
  to: number
  tz: string
  rules: WorkRule[]
  exceptions: WorkException[]
  /** Bezette momenten uit de gekoppelde agenda (Google freebusy). */
  busy: Interval[]
  /** Onze eigen, niet-geannuleerde afspraken. */
  appointments: Interval[]
  booking: BookingRules
  /** Referentiemoment voor de opzegtermijn; standaard nu. */
  now?: number
}

/**
 * De witte segmenten. Alles wat hier NIET in zit, is grijs — inclusief tijd die
 * te snel valt (opzegtermijn) of te ver in de toekomst ligt (horizon), zodat de
 * gebruiker letterlijk niet op een onboekbaar moment kán slepen.
 */
export function bookableSegments(input: BookableInput): Interval[] {
  const now = input.now ?? Date.now()
  const { booking } = input

  const work = workingIntervals(input.rules, input.exceptions, input.from, input.to, input.tz)

  // Buffers horen bij ELKE bezetting: ze verbreden het geblokkeerde stuk.
  const pad = (list: Interval[]): Interval[] => list.map((i) => ({
    start: i.start - booking.bufferBeforeMin * 60000,
    end: i.end + booking.bufferAfterMin * 60000,
  }))
  const blocked = mergeIntervals([...pad(input.busy), ...pad(input.appointments)])

  let free = subtractIntervals(work, blocked)

  // Te vroeg (opzegtermijn) en te ver weg (horizon) zijn ook gewoon grijs.
  const earliest = now + booking.minNoticeMin * 60000
  const latest = now + booking.maxHorizonDays * 86400000
  free = subtractIntervals(free, [
    { start: -8.64e15, end: earliest },
    { start: latest, end: 8.64e15 },
  ])

  // Segmenten die korter zijn dan één slot kun je toch niet gebruiken.
  const minLen = Math.max(1, booking.slotIntervalMin) * 60000
  return free.filter((i) => i.end - i.start >= minLen)
}

/** Valt [start, end) volledig binnen één wit segment? Dit is de hervalidatie. */
export function isBookable(segments: Interval[], start: number, end: number): boolean {
  if (end <= start) return false
  return segments.some((s) => start >= s.start && end <= s.end)
}

/** Afronden op het raster van de klant (bv. 15 of 30 minuten). */
export function snapToSlot(ms: number, slotMin: number, mode: 'floor' | 'ceil' = 'floor'): number {
  const step = Math.max(1, slotMin) * 60000
  return (mode === 'ceil' ? Math.ceil(ms / step) : Math.floor(ms / step)) * step
}
