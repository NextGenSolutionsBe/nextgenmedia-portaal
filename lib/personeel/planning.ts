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
