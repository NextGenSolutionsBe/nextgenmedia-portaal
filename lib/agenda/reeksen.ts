/**
 * Reeksen in de agenda (verbeterplan fase 3, 27 nov 2026): vaste blokken (Sales,
 * Focuswerk, Overleg, Opleiding …), herhalende afspraken en herhalende taken.
 * Pure regels, getest in tests/agenda-reeksen.test.ts.
 *
 * Een reeks bewaart enkel de regel (welke dagen, om de hoeveel weken, van tot);
 * de keren worden bij het tonen uitgerekend. Een keer overslaan = een uitzondering.
 * Een keer van een herhalende taak die afgevinkt of aangepast wordt, wordt een gewoon
 * item (ag_items.reeks_id + reeks_datum) en de reeks toont die dag dan niet meer.
 * De app plant zelf nooit iets in: een reeks bestaat enkel als iemand ze maakt.
 */
import { zoneNaarIso, plusDagen, type Item } from './model'

export type ReeksSoort = 'blok' | 'afspraak' | 'taak'
export type Reeks = {
  id: string
  soort: ReeksSoort
  blok_type: string | null
  titel: string
  kleur: string | null
  personen: string[]
  lijst_id: string | null
  prive: boolean
  /** 1 = maandag … 7 = zondag */
  dagen: number[]
  interval_weken: number
  van: string | null
  tot: string | null
  start_datum: string
  eind_datum: string | null
  uitzonderingen: string[]
  eigenaar_id: string | null
}

/** Soorten vaste blokken: eigen kleur, in de agenda met een slotje. */
export const BLOK_TYPES: { key: string; label: string; kleur: string }[] = [
  { key: 'sales', label: 'Sales', kleur: '#f59e0b' },
  { key: 'focus', label: 'Focuswerk', kleur: '#6366f1' },
  { key: 'overleg', label: 'Overleg', kleur: '#0ea5e9' },
  { key: 'opleiding', label: 'Opleiding', kleur: '#10b981' },
  { key: 'anders', label: 'Ander blok', kleur: '#64748b' },
]
export const blokType = (k: string | null | undefined) => BLOK_TYPES.find((b) => b.key === k) ?? BLOK_TYPES[BLOK_TYPES.length - 1]
export const DAG_KORT = ['ma', 'di', 'wo', 'do', 'vr', 'za', 'zo']

const UUR = /^([01]\d|2[0-3]):[0-5]\d$/
const DATUM = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** De weekdag (1 = ma … 7 = zo) van een datum. */
export const weekdagVan = (d: string) => ((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1
const maandag = (d: string) => plusDagen(d, 1 - weekdagVan(d))
const wekenTussen = (a: string, b: string) => Math.round((Date.parse(`${maandag(b)}T12:00:00Z`) - Date.parse(`${maandag(a)}T12:00:00Z`)) / (7 * 86_400_000))

/** Op welke dagen (YYYY-MM-DD) valt de reeks tussen van en tot (beide inclusief)? */
export function keren(r: Pick<Reeks, 'dagen' | 'interval_weken' | 'start_datum' | 'eind_datum' | 'uitzonderingen'>, van: string, tot: string): string[] {
  const uit: string[] = []
  const begin = van > r.start_datum ? van : r.start_datum
  const einde = r.eind_datum && r.eind_datum < tot ? r.eind_datum : tot
  if (begin > einde || !r.dagen.length) return uit
  const stap = Math.max(1, r.interval_weken || 1)
  const over = new Set(r.uitzonderingen ?? [])
  for (let d = begin, n = 0; d <= einde && n < 400; d = plusDagen(d, 1), n++) {
    if (!r.dagen.includes(weekdagVan(d))) continue
    if (wekenTussen(r.start_datum, d) % stap !== 0) continue
    if (over.has(d)) continue
    uit.push(d)
  }
  return uit
}

export const reeksItemId = (reeksId: string, datum: string) => `reeks:${reeksId}:${datum}`
export function leesReeksItemId(id: string): { reeksId: string; datum: string } | null {
  const m = /^reeks:([0-9a-f-]{36}):(\d{4}-\d{2}-\d{2})$/i.exec(id)
  return m ? { reeksId: m[1], datum: m[2] } : null
}

/** De keren als items voor de kalender (bron 'reeks'). `al` = dagen die al een eigen item hebben. */
export function reeksItems(r: Reeks, van: string, tot: string, al: Set<string> = new Set()): Item[] {
  const kleur = r.kleur || (r.soort === 'blok' ? blokType(r.blok_type).kleur : null)
  return keren(r, van, tot).filter((d) => !al.has(d)).map((d) => {
    const metUur = !!(r.van && r.tot)
    return {
      id: reeksItemId(r.id, d), bron: 'reeks', soort: r.soort === 'taak' ? 'taak' : 'meeting',
      titel: r.titel, beschrijving: null, status: 'open', clickup_status: null, clickup_status_kleur: null,
      urgent: false, prioriteit: null,
      start_op: metUur ? zoneNaarIso(d, r.van!) : zoneNaarIso(d, '04:00'),
      eind_op: metUur ? zoneNaarIso(d, r.tot!) : zoneNaarIso(d, '04:00'),
      heel_dag: !metUur, deadline_op: null,
      lijst_id: r.lijst_id, parent_id: null, client_id: null, labels: [], kleur,
      locatie: null, meet_url: null, prive: r.prive, eigenaar_id: r.eigenaar_id,
      toegewezen: r.personen, afgerond_op: null, afgerond_door: null, clickup_url: null, velden: null,
      updated_at: '', reeks: { id: r.id, soort: r.soort, blok_type: r.blok_type, datum: d },
    } satisfies Item
  })
}

export type ReeksInvoer = Omit<Reeks, 'id' | 'eigenaar_id' | 'uitzonderingen'> & { uitzonderingen?: string[] }

/** Nakijken wat iemand invult. Geeft de nette reeks of een fout in gewone taal. */
export function controleerReeks(b: Record<string, unknown>): { ok: true; reeks: ReeksInvoer } | { ok: false; fout: string } {
  const soort = (['blok', 'afspraak', 'taak'] as const).find((s) => s === b.soort) ?? null
  if (!soort) return { ok: false, fout: 'Kies een soort: vast blok, afspraak of taak.' }
  const blok_type = soort === 'blok' ? blokType(String(b.blok_type ?? '')).key : null
  const titel = String(b.titel ?? '').trim().slice(0, 200) || (soort === 'blok' ? blokType(blok_type).label : '')
  if (!titel) return { ok: false, fout: 'Geef de reeks een titel.' }
  const dagen = Array.from(new Set((Array.isArray(b.dagen) ? b.dagen : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 7))).sort()
  if (!dagen.length) return { ok: false, fout: 'Kies minstens één dag.' }
  const van = b.van ? String(b.van) : null, tot = b.tot ? String(b.tot) : null
  if ((van && !UUR.test(van)) || (tot && !UUR.test(tot))) return { ok: false, fout: 'Uur als 09:00.' }
  if (soort !== 'taak' && (!van || !tot)) return { ok: false, fout: 'Een blok of afspraak heeft een begin- en einduur.' }
  if (van && tot && tot <= van) return { ok: false, fout: 'Het einde ligt na het begin.' }
  const start_datum = String(b.start_datum ?? '')
  if (!DATUM.test(start_datum)) return { ok: false, fout: 'Kies vanaf wanneer.' }
  const eind_datum = b.eind_datum ? String(b.eind_datum) : null
  if (eind_datum && (!DATUM.test(eind_datum) || eind_datum < start_datum)) return { ok: false, fout: 'Het einde ligt na de start.' }
  const interval_weken = Math.min(8, Math.max(1, Number(b.interval_weken) || 1))
  const personen = Array.from(new Set((Array.isArray(b.personen) ? b.personen : []).map(String).filter((p) => UUID.test(p))))
  if (!personen.length) return { ok: false, fout: 'Voor wie is de reeks?' }
  const lijst_id = b.lijst_id && UUID.test(String(b.lijst_id)) ? String(b.lijst_id) : null
  if (soort === 'taak' && !lijst_id) return { ok: false, fout: 'Kies de map van de taak.' }
  const kleur = typeof b.kleur === 'string' && /^#[0-9a-f]{6}$/i.test(b.kleur) ? b.kleur : null
  const uitzonderingen = Array.isArray(b.uitzonderingen) ? b.uitzonderingen.map(String).filter((d) => DATUM.test(d)) : undefined
  return { ok: true, reeks: { soort, blok_type, titel, kleur, personen, lijst_id, prive: b.prive === true, dagen, interval_weken, van, tot, start_datum, eind_datum, ...(uitzonderingen ? { uitzonderingen } : {}) } }
}

/** "Elke ma en wo, 09:00–11:00" of "Om de 2 weken op vr". */
export function reeksTekst(r: Pick<Reeks, 'dagen' | 'interval_weken' | 'van' | 'tot'>): string {
  const d = r.dagen.length === 5 && [1, 2, 3, 4, 5].every((x) => r.dagen.includes(x)) ? 'werkdag' : r.dagen.map((x) => DAG_KORT[x - 1]).join(', ')
  const wanneer = r.interval_weken > 1 ? `Om de ${r.interval_weken} weken op ${d}` : `Elke ${d}`
  return r.van && r.tot ? `${wanneer}, ${r.van}–${r.tot}` : wanneer
}

/**
 * Vaste blokken van een persoon die een moment raken (voor de Meeting Inplanner):
 * klantboekingen nooit in een blok, intern een waarschuwing.
 */
export function blokkenOpMoment(reeksen: Reeks[], persoonId: string, startIso: string, eindIso: string): { reeks: Reeks; datum: string }[] {
  const s = Date.parse(startIso), e = Date.parse(eindIso)
  if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) return []
  const van = new Date(s - 86_400_000).toISOString().slice(0, 10), tot = new Date(e + 86_400_000).toISOString().slice(0, 10)
  const uit: { reeks: Reeks; datum: string }[] = []
  for (const r of reeksen) {
    if (r.soort !== 'blok' || !r.van || !r.tot || !r.personen.includes(persoonId)) continue
    for (const d of keren(r, van, tot)) {
      const bs = Date.parse(zoneNaarIso(d, r.van)), be = Date.parse(zoneNaarIso(d, r.tot))
      if (bs < e && be > s) uit.push({ reeks: r, datum: d })
    }
  }
  return uit
}

/** Alle vaste blokken van een persoon in een periode, als tijdvakken (ms). Voor de vrije momenten van de Meeting Inplanner. */
export function blokIntervallen(reeksen: Reeks[], persoonId: string, vanMs: number, totMs: number): { start: number; end: number; titel: string }[] {
  const van = new Date(vanMs - 86_400_000).toISOString().slice(0, 10), tot = new Date(totMs + 86_400_000).toISOString().slice(0, 10)
  const uit: { start: number; end: number; titel: string }[] = []
  for (const r of reeksen) {
    if (r.soort !== 'blok' || !r.van || !r.tot || !r.personen.includes(persoonId)) continue
    for (const d of keren(r, van, tot)) {
      const start = Date.parse(zoneNaarIso(d, r.van)), end = Date.parse(zoneNaarIso(d, r.tot))
      if (start < totMs && end > vanMs) uit.push({ start, end, titel: r.titel })
    }
  }
  return uit.sort((a, b) => a.start - b.start)
}
