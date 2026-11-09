/**
 * Wie de offerte stuurt.
 *  - Het bedrijf: altijd NextGen Agency BV (vaste gegevens, zie BEDRIJF). Die
 *    staan op elke offerte en in de algemene voorwaarden.
 *  - De contactpersoon (Marco of Bram): naam, functie, telefoon, e-mail en
 *    foto komen uit Personeel, zodat er maar één plek is om ze bij te houden.
 * Offertes → Instellingen bewaart enkel nog de betalingstermijn
 * (`app_settings.offerte_instellingen`). Puur: pdf, formulier en tests
 * gebruiken dezelfde regels.
 */

import type { Verantwoordelijke } from './offerte-fiche'

export const OFFERTE_INSTELLINGEN_SLEUTEL = 'offerte_instellingen'

/** De vaste bedrijfsgegevens op elke offerte. */
export const BEDRIJF = {
  vennootschap: 'NextGen Agency BV',
  handelsnaam: 'NextGenMedia',
  ondernemingsnummer: '1044.961.303',
  btw: 'BE1044.961.303',
  adres: 'Corda Campus, Kempische Steenweg 293/16 B, 3500 Hasselt',
  vertegenwoordiger: 'Bram Reinquin, zaakvoerder',
  email: 'legal@nextgenmedia.be',
} as const

export type OfferteContact = { naam: string; functie: string; telefoon: string; email: string; heeftFoto?: boolean }
export type OfferteInstellingen = { betalingstermijn: number }

export const STANDAARD_OFFERTE_INSTELLINGEN: OfferteInstellingen = { betalingstermijn: 14 }

const tekst = (v: unknown, max: number) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max)
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/

export function leesOfferteInstellingen(ruw: unknown): OfferteInstellingen {
  const r = (ruw && typeof ruw === 'object' ? ruw : {}) as Record<string, unknown>
  const t = Number(r.betalingstermijn)
  return { betalingstermijn: Number.isInteger(t) && t >= 0 && t <= 120 ? t : STANDAARD_OFFERTE_INSTELLINGEN.betalingstermijn }
}

export function controleerOfferteInstellingen(b: unknown): { ok: true; waarde: OfferteInstellingen } | { ok: false; fout: string } {
  const r = (b && typeof b === 'object' ? b : {}) as Record<string, unknown>
  const t = Number(r.betalingstermijn)
  if (!Number.isInteger(t) || t < 0 || t > 120) return { ok: false, fout: 'De betalingstermijn is een aantal dagen, bv. 14.' }
  return { ok: true, waarde: { betalingstermijn: t } }
}

/** Standaard als Personeel (nog) niets heeft: de naam en info@. */
const TERUGVAL: Record<Verantwoordelijke, OfferteContact> = {
  marco: { naam: 'Marco Castermans', functie: 'Zaakvoerder', telefoon: '', email: 'info@nextgenmedia.be' },
  bram: { naam: 'Bram Reinquin', functie: 'Zaakvoerder', telefoon: '', email: 'info@nextgenmedia.be' },
}

/** Een rij uit Personeel naar de contactpersoon op de offerte; lege velden vallen terug. */
export function contactUitPersoneel(wie: Verantwoordelijke, p: { voornaam?: string | null; achternaam?: string | null; functie?: string | null; telefoon?: string | null; email?: string | null; profielfoto_pad?: string | null } | null | undefined): OfferteContact {
  const std = TERUGVAL[wie]
  if (!p) return { ...std, heeftFoto: false }
  const naam = tekst([p.voornaam, p.achternaam].filter(Boolean).join(' '), 80)
  const email = tekst(p.email, 160)
  return {
    naam: naam || std.naam,
    functie: tekst(p.functie, 80) || std.functie,
    telefoon: tekst(p.telefoon, 40),
    email: EMAIL.test(email) ? email : std.email,
    heeftFoto: !!p.profielfoto_pad,
  }
}

export type OfferteBedrijf = {
  /** Merk bovenaan de offerte (NextGenMedia of NextGenSolutions). */
  naam: string
  vennootschap: string; handelsnaam: string; adres: string; ondernemingsnummer: string; btw: string
  vertegenwoordiger: string; email: string; website: string
}

export function offerteBedrijf(merk: { naam: string; website: string }): OfferteBedrijf {
  return { naam: merk.naam, ...BEDRIJF, website: merk.website }
}
