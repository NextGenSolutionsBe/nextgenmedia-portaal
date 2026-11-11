/**
 * Regels die Marco, Bram en Chiara samen tekenen — gedeeld door Uitgaven
 * vennoten en Vesting. Elke aanpassing is een nieuwe versie die alle drie
 * opnieuw tekenen met hun eigen account; een handtekening hoort bij exact de
 * tekst van die versie (`regelsTekstVoor`). Puur: scherm, server en tests
 * gebruiken dezelfde regels.
 *
 * Vennoten: tabel `vennoot_regels` (met budget en startmaand, tekst ongewijzigd
 * zodat bestaande handtekeningen geldig blijven). Vesting: tabel `vesting_regels`.
 */

import { VENNOTEN, type Vennoot } from './vesting-akkoord'
import { regelsTekst as vennotenTekst, type RegelHandtekening } from './vennoot-uitgaven'

export type RegelSet = 'vennoten' | 'vesting'
export type { RegelHandtekening }

export type AlgemeneRegelsVersie = {
  id: string; versie: number; regels: string[]; created_at: string | null; created_by: string | null
  /** Enkel bij Uitgaven vennoten. */
  maandbudget?: number | null; start_maand?: string | null
}

/** Wat het scherm van een regelset krijgt. */
export type RegelsData = {
  versie: AlgemeneRegelsVersie | null
  handtekeningen: RegelHandtekening[]
  namen: Record<Vennoot, string>
  ik: Vennoot | null
}

export const REGELSETS: Record<RegelSet, { titel: string; module: string; metBudget: boolean; api: string; pagina: string }> = {
  vennoten: { titel: 'Regels uitgaven vennoten', module: 'Uitgaven vennoten', metBudget: true, api: '/api/admin/vennoten', pagina: '/admin/vennoten' },
  vesting: { titel: 'Regels vesting', module: 'Vesting', metBudget: false, api: '/api/admin/vesting/regels', pagina: '/admin/vesting' },
}

/** Wat er bij Vesting precies getekend wordt. */
export function vestingRegelsTekst(v: Pick<AlgemeneRegelsVersie, 'versie' | 'regels'>): string {
  return [`Regels vesting, versie ${v.versie}`, ...v.regels.map((r, i) => `${i + 1}. ${r}`)].join('\n')
}

export function regelsTekstVoor(set: RegelSet, v: AlgemeneRegelsVersie): string {
  if (set === 'vennoten') return vennotenTekst({ versie: v.versie, regels: v.regels, maandbudget: Number(v.maandbudget ?? 0), start_maand: String(v.start_maand ?? '') })
  return vestingRegelsTekst(v)
}

/** Wie tekende deze versie (met exact deze tekst)? */
export function tekenStandVoor(set: RegelSet, v: AlgemeneRegelsVersie | null, handtekeningen: RegelHandtekening[]): Record<Vennoot, RegelHandtekening | null> & { allen: boolean } {
  const tekst = v ? regelsTekstVoor(set, v) : null
  const per = Object.fromEntries(VENNOTEN.map((k) => [k, (tekst && handtekeningen.find((h) => h.vennoot === k && h.inhoud_tekst === tekst)) || null])) as Record<Vennoot, RegelHandtekening | null>
  return { ...per, allen: !!tekst && VENNOTEN.every((k) => !!per[k]) }
}

/** Vestingregels uit een verzoek: één per lijn, nummering en opsommingstekens weg, hoogstens 60 van elk 1000 tekens. */
export function controleerVestingRegels(b: Record<string, unknown>): { ok: true; waarde: { regels: string[] } } | { ok: false; fout: string } {
  const ruw = Array.isArray(b.regels) ? b.regels.map(String) : String(b.regels ?? '').split('\n')
  const regels = ruw.map((r) => r.replace(/^\s*(\d+[.)]|[-•*])\s*/, '').replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (!regels.length) return { ok: false, fout: 'Schrijf minstens één regel.' }
  if (regels.length > 60) return { ok: false, fout: 'Hoogstens 60 regels.' }
  if (regels.some((r) => r.length > 1000)) return { ok: false, fout: 'Hou elke regel onder de 1000 tekens.' }
  return { ok: true, waarde: { regels } }
}

/** Wat veranderde er tegenover de vorige versie? Voor de regelsviewer. */
export function verschilMetVorige(nu: AlgemeneRegelsVersie, vorige: AlgemeneRegelsVersie | null): { nieuw: boolean[]; weg: string[]; budget: boolean; start: boolean } {
  if (!vorige) return { nieuw: nu.regels.map(() => false), weg: [], budget: false, start: false }
  const oud = new Set(vorige.regels.map((r) => r.trim()))
  const hier = new Set(nu.regels.map((r) => r.trim()))
  return {
    nieuw: nu.regels.map((r) => !oud.has(r.trim())),
    weg: vorige.regels.filter((r) => !hier.has(r.trim())),
    budget: (nu.maandbudget ?? null) !== (vorige.maandbudget ?? null),
    start: (nu.start_maand ?? null) !== (vorige.start_maand ?? null),
  }
}
