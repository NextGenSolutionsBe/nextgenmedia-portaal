import { controleerTotp, formatteerGeheim, nieuwGeheim, otpauthUri } from './totp'
import { genereerHerstelcodes, hashHerstelcode, normaliseerHerstelcode, ontsleutel, versleutel } from './geheimen'

/**
 * De regels van tweestapsverificatie met een authenticator-app — zonder
 * databank of HTTP, zodat elke regel getest kan worden (tests/twofa.test.ts).
 * De API-routes zijn dun: sessie bepalen → deze functies → antwoord.
 *
 * Opslag, klok en pogingslimiet worden meegegeven. Elke schrijfactie die een
 * race zou kunnen verliezen (code opnieuw gebruiken, herstelcode twee keer
 * gebruiken, setup bevestigen) is in de opslag één atomische voorwaardelijke
 * update: "enkel als nog niet gebruikt".
 */

export type TotpRij = {
  user_id: string
  secret_enc: string | null
  actief: boolean
  geactiveerd_op: string | null
  laatste_stap: number | null
  setup_secret_enc: string | null
  setup_gestart_op: string | null
  /** Wie de lopende setup startte (een admin die voor iemand koppelt), anders null. */
  setup_door?: string | null
}

export interface TwofaOpslag {
  lees(userId: string): Promise<TotpRij | null>
  /** Nieuwe (onbevestigde) setup bewaren — nooit over een actieve TOTP heen. */
  bewaarSetup(userId: string, setupEnc: string, op: string, door?: string | null): Promise<boolean>
  /** Activeren, enkel als de setup nog exact deze waarde heeft en TOTP niet actief is. */
  activeer(userId: string, setupEnc: string, stap: number, op: string): Promise<boolean>
  /** Tijdstap claimen: enkel als die groter is dan de laatst gebruikte (replay). */
  claimStap(userId: string, stap: number): Promise<boolean>
  verwijder(userId: string): Promise<void>
  /** Alle vorige herstelcodes ongeldig maken en deze hashes bewaren. */
  vervangHerstelcodes(userId: string, hashes: string[]): Promise<void>
  /** Code verbruiken: enkel als ze bestaat en nog niet gebruikt is. */
  gebruikHerstelcode(userId: string, hash: string, op: string): Promise<boolean>
  aantalHerstelcodes(userId: string): Promise<number>
}

/** true = toegestaan. Telt de poging mee. */
export type Limiet = (sleutel: string, limiet: number, vensterSec: number) => Promise<boolean>

export type Kern = { opslag: TwofaOpslag; sleutel: Buffer; limiet: Limiet; nu: () => number }

export type Fout = { ok: false; fout: string; status: number }
export type Uitkomst<T extends object = object> = ({ ok: true } & T) | Fout

// Bewust vaag: nooit prijsgeven WAAROM iets mislukte.
export const FOUT_CODE = 'De code is ongeldig of verlopen.'
export const FOUT_HERBEVESTIGING = 'Het wachtwoord of de code is ongeldig.'
export const FOUT_TE_VEEL = 'Te veel pogingen. Probeer het later opnieuw.'

export const SETUP_GELDIG_MS = 15 * 60 * 1000

const fout = (f: string, status = 400): Fout => ({ ok: false, fout: f, status })

/** Meerdere vensters tegelijk (bv. per 5 minuten én per dag). */
async function binnenLimieten(k: Kern, basis: string, vensters: [number, number][]): Promise<boolean> {
  for (const [limiet, sec] of vensters) {
    if (!(await k.limiet(`${basis}:${sec}`, limiet, sec))) return false
  }
  return true
}

/** 1. Setup starten: nieuw geheim, versleuteld bewaard; nog NIET actief. */
export async function startSetup(k: Kern, userId: string, account: string, door: string | null = null): Promise<Uitkomst<{ geheim: string; geheimLeesbaar: string; uri: string }>> {
  const rij = await k.opslag.lees(userId)
  if (rij?.actief) return fout('Tweestapsverificatie met een app is al actief.', 409)
  if (!(await binnenLimieten(k, `2fa-setup:${userId}`, [[10, 3600]]))) return fout(FOUT_TE_VEEL, 429)
  const geheim = nieuwGeheim()
  const ok = await k.opslag.bewaarSetup(userId, versleutel(k.sleutel, geheim), new Date(k.nu()).toISOString(), door)
  if (!ok) return fout('Tweestapsverificatie met een app is al actief.', 409)
  return { ok: true, geheim, geheimLeesbaar: formatteerGeheim(geheim), uri: otpauthUri(geheim, account) }
}

/** 2. Setup bevestigen met een geldige code → pas dan actief + herstelcodes. */
export async function bevestigSetup(k: Kern, userId: string, code: string): Promise<Uitkomst<{ herstelcodes: string[] }>> {
  if (!(await binnenLimieten(k, `2fa-bevestig:${userId}`, [[5, 600], [20, 86400]]))) return fout(FOUT_TE_VEEL, 429)
  const rij = await k.opslag.lees(userId)
  if (!rij || rij.actief || !rij.setup_secret_enc || !rij.setup_gestart_op) return fout(FOUT_CODE)
  if (k.nu() - Date.parse(rij.setup_gestart_op) > SETUP_GELDIG_MS) return fout('Deze QR-code is verlopen. Start de instelling opnieuw.')
  let geheim: string
  try { geheim = ontsleutel(k.sleutel, rij.setup_secret_enc) } catch { return fout('Start de instelling opnieuw.') }
  const stap = controleerTotp(geheim, code.trim(), k.nu())
  if (stap === null) return fout(FOUT_CODE)
  if (!(await k.opslag.activeer(userId, rij.setup_secret_enc, stap, new Date(k.nu()).toISOString()))) return fout(FOUT_CODE)
  const herstelcodes = genereerHerstelcodes()
  await k.opslag.vervangHerstelcodes(userId, herstelcodes.map((c) => hashHerstelcode(k.sleutel, normaliseerHerstelcode(c)!)))
  return { ok: true, herstelcodes }
}

export type FactorInvoer = { code?: string | null; herstelcode?: string | null }

/**
 * 3. De tweede factor controleren: een code uit de app OF een herstelcode.
 * Mislukt altijd met dezelfde melding. Een corrupt geheim laat de app-code
 * falen, maar herstelcodes blijven werken (die hebben het geheim niet nodig).
 */
export async function controleerFactor(k: Kern, userId: string, invoer: FactorInvoer): Promise<Uitkomst<{ methode: 'totp' | 'herstelcode'; herstelcodesOver?: number }>> {
  if (!(await binnenLimieten(k, `2fa-factor:${userId}`, [[5, 300], [20, 86400]]))) return fout(FOUT_TE_VEEL, 429)
  const rij = await k.opslag.lees(userId)
  if (!rij?.actief) return fout(FOUT_CODE)
  const nu = new Date(k.nu()).toISOString()

  if (invoer.herstelcode) {
    const norm = normaliseerHerstelcode(invoer.herstelcode)
    if (!norm) return fout(FOUT_CODE)
    if (!(await k.opslag.gebruikHerstelcode(userId, hashHerstelcode(k.sleutel, norm), nu))) return fout(FOUT_CODE)
    return { ok: true, methode: 'herstelcode', herstelcodesOver: await k.opslag.aantalHerstelcodes(userId) }
  }

  const code = String(invoer.code ?? '').trim()
  if (!rij.secret_enc || !/^\d{6}$/.test(code)) return fout(FOUT_CODE)
  let geheim: string
  try { geheim = ontsleutel(k.sleutel, rij.secret_enc) } catch { return fout(FOUT_CODE) }
  const stap = controleerTotp(geheim, code, k.nu())
  if (stap === null) return fout(FOUT_CODE)
  // Dezelfde (of een oudere) code opnieuw → geweigerd.
  if (!(await k.opslag.claimStap(userId, stap))) return fout(FOUT_CODE)
  return { ok: true, methode: 'totp' }
}

/** 4. Uitschakelen: wachtwoord én (app-code of herstelcode). */
export async function schakelUit(k: Kern, userId: string, p: { wachtwoordOk: boolean } & FactorInvoer): Promise<Uitkomst> {
  if (!(await binnenLimieten(k, `2fa-uit:${userId}`, [[5, 900]]))) return fout(FOUT_TE_VEEL, 429)
  // Eerst het wachtwoord: bij een fout wachtwoord wordt er geen herstelcode verbruikt.
  if (!p.wachtwoordOk) return fout(FOUT_HERBEVESTIGING)
  if (!p.code && !p.herstelcode) return fout(FOUT_HERBEVESTIGING)
  const f = await controleerFactor(k, userId, p)
  if (!f.ok) return f.status === 429 ? f : fout(FOUT_HERBEVESTIGING)
  await k.opslag.verwijder(userId)
  await k.opslag.vervangHerstelcodes(userId, [])
  return { ok: true }
}

/** 5. Nieuwe herstelcodes: wachtwoord én een code uit de app; oude codes vervallen. */
export async function nieuweHerstelcodes(k: Kern, userId: string, p: { wachtwoordOk: boolean; code?: string | null }): Promise<Uitkomst<{ herstelcodes: string[] }>> {
  if (!(await binnenLimieten(k, `2fa-herstel:${userId}`, [[5, 900]]))) return fout(FOUT_TE_VEEL, 429)
  if (!p.wachtwoordOk || !p.code) return fout(FOUT_HERBEVESTIGING)
  const f = await controleerFactor(k, userId, { code: p.code })
  if (!f.ok) return f.status === 429 ? f : fout(FOUT_HERBEVESTIGING)
  const herstelcodes = genereerHerstelcodes()
  await k.opslag.vervangHerstelcodes(userId, herstelcodes.map((c) => hashHerstelcode(k.sleutel, normaliseerHerstelcode(c)!)))
  return { ok: true, herstelcodes }
}

/**
 * 6. Een admin bevestigt zijn eigen identiteit vóór een gevoelige actie op een
 * ANDER account (bv. de 2FA van een werknemer uitzetten): altijd het eigen
 * wachtwoord, en — heeft de admin zelf een authenticator-app — ook een code
 * daaruit. Zo vraagt de actie minstens wat de admin zelf bij het inloggen toont.
 */
export async function herbevestigAdmin(k: Kern, adminId: string, p: { wachtwoordOk: boolean; code?: string | null }): Promise<Uitkomst> {
  if (!(await binnenLimieten(k, `2fa-admin:${adminId}`, [[5, 900]]))) return fout(FOUT_TE_VEEL, 429)
  if (!p.wachtwoordOk) return fout(FOUT_HERBEVESTIGING)
  const eigen = await k.opslag.lees(adminId)
  if (!eigen?.actief) return { ok: true }
  if (!p.code) return fout(FOUT_HERBEVESTIGING)
  const f = await controleerFactor(k, adminId, { code: p.code })
  if (!f.ok) return f.status === 429 ? f : fout(FOUT_HERBEVESTIGING)
  return { ok: true }
}
