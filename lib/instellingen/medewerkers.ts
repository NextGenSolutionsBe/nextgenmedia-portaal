// Gedeelde types voor het medewerkersbeheer (API ↔ scherm). Puur.
import type { Rol } from './model'

export type Medewerker = {
  /** staff_members.id, of 'admin:<auth_user_id>' voor een hoofdbeheerder. */
  id: string
  authUserId: string | null
  isAdmin: boolean
  email: string | null
  naam: string | null
  voornaam: string | null
  achternaam: string | null
  functie: string | null
  rol: Rol
  /** Toegestane modules (werknemers); null = alles (hoofdbeheerder). */
  permissions: string[] | null
  actief: boolean
  gearchiveerd: boolean
  laatsteLogin: string | null
  aangemaakt: string | null
  uitnodigingOp: string | null
  tweeFactor: boolean
}

export const ADMIN_ID_PREFIX = 'admin:'
export const isAdminId = (id: string) => id.startsWith(ADMIN_ID_PREFIX)
export const adminUid = (id: string) => id.slice(ADMIN_ID_PREFIX.length)

export function volledigeNaam(m: { voornaam?: string | null; achternaam?: string | null; naam?: string | null; email?: string | null }): string {
  const v = `${m.voornaam ?? ''} ${m.achternaam ?? ''}`.trim()
  return v || m.naam || m.email || 'Onbekend'
}

export function splitsNaam(naam: string | null | undefined): { voornaam: string; achternaam: string } {
  const delen = (naam ?? '').trim().split(/\s+/).filter(Boolean)
  return { voornaam: delen[0] ?? '', achternaam: delen.slice(1).join(' ') }
}

/** Een ban die praktisch permanent is (100 jaar), zodat een gedeactiveerd account niet kan inloggen. */
export const BAN_DUUR = '876000h'
