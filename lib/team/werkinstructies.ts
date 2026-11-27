/**
 * Werkinstructies in Informatief (verbeterplan fase 4, punt 49): per bedrijf,
 * dienst of rol, met versies en "Gelezen". Pure regels, getest in
 * tests/team-rollen.test.ts. Een nieuwe versie vraagt iedereen opnieuw te lezen.
 */
import { MEDIA, SOLUTIONS } from '@/lib/bedrijven/model'

export type Werkinstructie = {
  id: string
  titel: string
  inhoud: string
  bedrijf: string | null
  dienst_slug: string | null
  rol_sjabloon: string | null
  versie: number
  gearchiveerd_op: string | null
  gewijzigd_door: string | null
  updated_at: string
}

export type InstructieInvoer = Pick<Werkinstructie, 'titel' | 'inhoud' | 'bedrijf' | 'dienst_slug' | 'rol_sjabloon'>

const SLUG = /^[a-z0-9][a-z0-9_-]{0,60}$/

export function controleerInstructie(b: Record<string, unknown>): { ok: true; invoer: InstructieInvoer } | { ok: false; fout: string } {
  const titel = String(b.titel ?? '').trim().slice(0, 160)
  if (!titel) return { ok: false, fout: 'Geef de werkinstructie een titel.' }
  const inhoud = String(b.inhoud ?? '').replace(/\r\n/g, '\n').trim().slice(0, 20000)
  if (!inhoud) return { ok: false, fout: 'Schrijf wat de instructie zegt.' }
  const bedrijf = b.bedrijf === MEDIA || b.bedrijf === SOLUTIONS ? b.bedrijf : null
  const dienst_slug = typeof b.dienst_slug === 'string' && SLUG.test(b.dienst_slug) ? b.dienst_slug : null
  const rol_sjabloon = typeof b.rol_sjabloon === 'string' && /^[a-z][a-z0-9_]{1,40}$/.test(b.rol_sjabloon) ? b.rol_sjabloon : null
  return { ok: true, invoer: { titel, inhoud, bedrijf, dienst_slug, rol_sjabloon } }
}

/** Is er inhoudelijk iets veranderd (dan een nieuwe versie)? Enkel labels aanpassen telt niet. */
export const nieuweVersieNodig = (oud: Pick<Werkinstructie, 'titel' | 'inhoud'>, nieuw: Pick<InstructieInvoer, 'titel' | 'inhoud'>) =>
  oud.titel.trim() !== nieuw.titel.trim() || oud.inhoud.trim() !== nieuw.inhoud.trim()

/**
 * Geldt een instructie voor iemand? Zonder bedrijf en rol: voor iedereen.
 * Met een bedrijf: enkel wie toegang heeft tot dat bedrijf (leeg = alle bedrijven).
 * Met een rol: enkel wie dat rolsjabloon heeft. Een hoofdbeheerder ziet alles.
 */
export function geldtVoor(i: Pick<Werkinstructie, 'bedrijf' | 'rol_sjabloon'>, p: { isAdmin: boolean; bedrijven: string[]; sjabloon: string | null }): boolean {
  if (p.isAdmin) return true
  if (i.bedrijf && p.bedrijven.length && !p.bedrijven.includes(i.bedrijf)) return false
  if (i.rol_sjabloon && i.rol_sjabloon !== p.sjabloon) return false
  return true
}

export type LeesStand = 'gelezen' | 'nieuwe_versie' | 'ongelezen'

/** Las ik de huidige versie, een oudere, of nog niets? */
export function leesStand(versie: number, gelezenVersies: number[]): LeesStand {
  if (gelezenVersies.includes(versie)) return 'gelezen'
  return gelezenVersies.length ? 'nieuwe_versie' : 'ongelezen'
}

export const LEES_LABEL: Record<LeesStand, string> = { gelezen: 'Gelezen', nieuwe_versie: 'Nieuwe versie', ongelezen: 'Nog niet gelezen' }
