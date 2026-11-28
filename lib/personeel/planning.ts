// Personeel — beschikbaarheid en planning. Puur en testbaar.
//
// Beschikbaarheid is een AANBOD van de medewerker, nog geen planning. Pas
// wanneer een admin (een deel van) het tijdsblok goedkeurt of iemand
// rechtstreeks inplant, ontstaat een werkblok.

import { isDag, isUur, minutenVanUur, overlapt } from './tijd'
import type { BeschikbaarheidStatus } from './model'

export type Blok = { start: string; eind: string }

/** Tijdsblokken van een aanvraag controleren (één of meerdere per dag). */
export function controleerBlokken(dag: string, blokken: Blok[]): string | null {
  if (!isDag(dag)) return 'Kies een geldige datum.'
  if (!blokken.length) return 'Voeg minstens één tijdsblok toe.'
  const lijst = blokken.map((b) => ({ start: b.start?.slice(0, 5), eind: b.eind?.slice(0, 5) }))
  for (const b of lijst) {
    if (!isUur(b.start) || !isUur(b.eind)) return 'Vul een geldig begin- en einduur in (uu:mm).'
    if (minutenVanUur(b.eind) <= minutenVanUur(b.start)) return 'Het einduur moet na het beginuur liggen.'
  }
  const s = [...lijst].sort((a, b) => a.start.localeCompare(b.start))
  for (let i = 1; i < s.length; i++) if (minutenVanUur(s[i].start) < minutenVanUur(s[i - 1].eind)) return 'Tijdsblokken op dezelfde dag mogen niet overlappen.'
  return null
}

/** Mag de medewerker deze beschikbaarheid nog intrekken? Enkel zolang ze niet bevestigd is. */
export const magIntrekken = (status: BeschikbaarheidStatus | string) => status === 'ingediend'

/**
 * Beslissing van een admin over een beschikbaarheid.
 *  · volledig goedkeuren → werkblok = het hele tijdsblok
 *  · gedeeltelijk → werkblok moet binnen het tijdsblok liggen
 *  · afwijzen → geen werkblok
 */
export type Beslissing =
  | { soort: 'goedkeuren' }
  | { soort: 'gedeeltelijk'; start: string; eind: string }
  | { soort: 'afwijzen'; reden?: string | null }

export function beslis(aanvraag: { status: string; start_tijd: string; eind_tijd: string }, b: Beslissing):
  { ok: true; status: BeschikbaarheidStatus; werkblok: Blok | null } | { ok: false; fout: string } {
  if (aanvraag.status !== 'ingediend') return { ok: false, fout: 'Deze beschikbaarheid is al behandeld of ingetrokken.' }
  const s = aanvraag.start_tijd.slice(0, 5), e = aanvraag.eind_tijd.slice(0, 5)
  if (b.soort === 'afwijzen') return { ok: true, status: 'afgewezen', werkblok: null }
  if (b.soort === 'goedkeuren') return { ok: true, status: 'goedgekeurd', werkblok: { start: s, eind: e } }
  const ps = b.start?.slice(0, 5), pe = b.eind?.slice(0, 5)
  if (!isUur(ps) || !isUur(pe) || minutenVanUur(pe) <= minutenVanUur(ps)) return { ok: false, fout: 'Geef een geldig deel van het tijdsblok.' }
  if (minutenVanUur(ps) < minutenVanUur(s) || minutenVanUur(pe) > minutenVanUur(e)) return { ok: false, fout: `Het goedgekeurde deel moet binnen ${s}–${e} liggen.` }
  if (ps === s && pe === e) return { ok: true, status: 'goedgekeurd', werkblok: { start: ps, eind: pe } }
  return { ok: true, status: 'gedeeltelijk', werkblok: { start: ps, eind: pe } }
}

/** Overlapt een nieuw werkblok met een bestaand (niet-geannuleerd) werkblok op dezelfde dag? */
export function planningOverlapt(nieuw: { id?: string; datum: string; start_tijd: string; eind_tijd: string }, bestaand: { id: string; datum: string; start_tijd: string; eind_tijd: string; status: string }[]): boolean {
  const a = { start: minutenVanUur(nieuw.start_tijd), eind: minutenVanUur(nieuw.eind_tijd) }
  return bestaand.some((b) => b.id !== nieuw.id && b.status !== 'geannuleerd' && b.datum === nieuw.datum && overlapt(a, { start: minutenVanUur(b.start_tijd), eind: minutenVanUur(b.eind_tijd) }))
}

/** Geplande minuten van een werkblok. */
export const blokMinuten = (b: { start_tijd: string; eind_tijd: string }) => Math.max(0, minutenVanUur(b.eind_tijd) - minutenVanUur(b.start_tijd))

/** Controleert een werkblok dat een admin rechtstreeks inplant. */
export function controleerWerkblok(w: { datum?: unknown; start_tijd?: unknown; eind_tijd?: unknown }): string | null {
  if (!isDag(w.datum)) return 'Kies een geldige datum.'
  if (!isUur(String(w.start_tijd ?? '').slice(0, 5)) || !isUur(String(w.eind_tijd ?? '').slice(0, 5))) return 'Vul een geldig begin- en einduur in.'
  if (minutenVanUur(String(w.eind_tijd)) <= minutenVanUur(String(w.start_tijd))) return 'Het einduur moet na het beginuur liggen.'
  return null
}

/** Maximumuren respecteren: geeft een waarschuwing (geen blokkade) als een grens overschreden wordt. */
export function maxUrenWaarschuwing(
  grenzen: { max_uren_dag?: number | null; max_uren_week?: number | null; max_uren_maand?: number | null },
  gepland: { dag: number; week: number; maand: number },
): string | null {
  const u = (m: number) => Math.round((m / 60) * 10) / 10
  if (grenzen.max_uren_dag && u(gepland.dag) > grenzen.max_uren_dag) return `Boven het maximum van ${grenzen.max_uren_dag} u per dag (${u(gepland.dag)} u gepland).`
  if (grenzen.max_uren_week && u(gepland.week) > grenzen.max_uren_week) return `Boven het maximum van ${grenzen.max_uren_week} u per week (${u(gepland.week)} u gepland).`
  if (grenzen.max_uren_maand && u(gepland.maand) > grenzen.max_uren_maand) return `Boven het maximum van ${grenzen.max_uren_maand} u per maand (${u(gepland.maand)} u gepland).`
  return null
}

// ── Inplannen enkel binnen opgegeven beschikbaarheid ─────────────────────────

/** Beschikbaarheden die meetellen: aangeboden of (deels) ingepland, niet ingetrokken of afgewezen. */
export const TELT_ALS_BESCHIKBAAR = ['ingediend', 'goedgekeurd', 'gedeeltelijk'] as const

type Aanbod = { id: string; datum: string; start_tijd: string; eind_tijd: string; status: string }

/**
 * Het aanbod waarbinnen een werkblok valt (zelfde dag, volledig binnen het
 * tijdsblok), of null. Aaneensluitende blokken (13:00–15:00 + 15:00–17:00)
 * tellen samen, zodat 13:00–17:00 ook kan.
 */
export function binnenBeschikbaarheid(blok: { datum: string; start_tijd: string; eind_tijd: string }, aanbod: Aanbod[]): Aanbod | null {
  const s = minutenVanUur(blok.start_tijd), e = minutenVanUur(blok.eind_tijd)
  const dag = aanbod
    .filter((a) => a.datum === blok.datum && (TELT_ALS_BESCHIKBAAR as readonly string[]).includes(a.status))
    .map((a) => ({ a, s: minutenVanUur(a.start_tijd), e: minutenVanUur(a.eind_tijd) }))
    .sort((x, y) => x.s - y.s)
  // Aaneensluitende blokken samenvoegen tot vensters; het eerste blok van het venster is "het" aanbod.
  const vensters: { a: Aanbod; s: number; e: number }[] = []
  for (const d of dag) {
    const laatste = vensters[vensters.length - 1]
    if (laatste && d.s <= laatste.e) laatste.e = Math.max(laatste.e, d.e)
    else vensters.push({ ...d })
  }
  return vensters.find((v) => v.s <= s && v.e >= e)?.a ?? null
}

/** Mensentaal voor de beschikbaarheid van een dag, voor foutmeldingen. */
export function beschikbaarheidTekst(datum: string, aanbod: Aanbod[]): string {
  const dag = aanbod.filter((a) => a.datum === datum && (TELT_ALS_BESCHIKBAAR as readonly string[]).includes(a.status))
    .sort((x, y) => x.start_tijd.localeCompare(y.start_tijd))
  return dag.length ? dag.map((a) => `${a.start_tijd.slice(0, 5)}–${a.eind_tijd.slice(0, 5)}`).join(', ') : ''
}

// ── Bevestiging door de medewerker ───────────────────────────────────────────

export type Bevestiging = 'te_bevestigen' | 'bevestigd' | 'geweigerd'
/** NULL = werkblok van vóór de bevestigingsflow: geldt als bevestigd. */
export const bevestigingVan = (w: { bevestiging?: string | null }): Bevestiging =>
  w.bevestiging === 'te_bevestigen' || w.bevestiging === 'geweigerd' ? w.bevestiging : 'bevestigd'
export const BEVESTIGING_INFO: Record<Bevestiging, { label: string; kleur: string }> = {
  te_bevestigen: { label: 'Wacht op bevestiging', kleur: 'bg-amber-50 text-amber-800 border-amber-200' },
  bevestigd: { label: 'Bevestigd', kleur: 'bg-green-50 text-green-800 border-green-200' },
  geweigerd: { label: 'Kan niet', kleur: 'bg-red-50 text-red-700 border-red-200' },
}
